import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"

// ─── sendTip ──────────────────────────────────────────────────────────────────

export const sendTip = mutation({
  args: {
    streamId: v.id("streams"),
    amount: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { streamId, amount, message }) => {
    const userId = await getAuthenticatedUser(ctx)

    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid tip amount")

    const user = await ctx.db.get(userId)
    if (!user?.username) throw new Error("Complete your profile to send tips")

    const balance = user.pointsBalance ?? 0
    if (balance < amount) throw new Error("Insufficient balance")

    const stream = await ctx.db.get(streamId)
    if (!stream) throw new Error("Stream not found")
    if (stream.status !== "live") throw new Error("Tips are only available on live streams")
    if (stream.creatorId === userId) throw new Error("Cannot tip yourself")

    // Atomic deduction
    await ctx.db.patch(userId, { pointsBalance: balance - amount })

    // Credit creator
    const creator = await ctx.db.get(stream.creatorId)
    const creatorBalance = creator?.pointsBalance ?? 0
    await ctx.db.patch(stream.creatorId, { pointsBalance: creatorBalance + amount })

    // Increment stream tip total for O(1) dashboard reads
    await ctx.db.patch(streamId, { tipTotal: (stream.tipTotal ?? 0) + amount })

    // Log transaction
    await ctx.db.insert("tipTransactions", {
      fromUserId: userId,
      toUserId: stream.creatorId,
      streamId,
      amount,
      message: message?.trim() || undefined,
      createdAt: Date.now(),
    })

    // Create alert for studio overlay
    await ctx.db.insert("tipAlerts", {
      streamId,
      fromUsername: user.username,
      amount,
      message: message?.trim() || undefined,
      createdAt: Date.now(),
    })
  },
})

// ─── getBalance ───────────────────────────────────────────────────────────────

export const getBalance = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return null
    }
    const user = await ctx.db.get(userId)
    return user?.pointsBalance ?? 0
  },
})

export const getTipTarget = internalQuery({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    const stream = await ctx.db.get(streamId)
    if (!stream) throw new Error("Stream not found")
    if (stream.status !== "live") throw new Error("Tips are only available on live streams")

    const creator = await ctx.db.get(stream.creatorId)
    if (!creator?.walletAddress) throw new Error("Creator wallet is unavailable")

    return {
      creatorId: stream.creatorId,
      creatorWalletAddress: creator.walletAddress,
      streamId: stream._id,
    }
  },
})

export const recordBroadcastTip = internalMutation({
  args: {
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    streamId: v.id("streams"),
    fromUsername: v.string(),
    amount: v.number(),
    message: v.optional(v.string()),
    solanaSignature: v.string(),
    tokenMint: v.string(),
  },
  handler: async (ctx, args) => {
    const stream = await ctx.db.get(args.streamId)
    if (!stream) throw new Error("Stream not found")

    await ctx.db.patch(args.streamId, {
      tipTotal: (stream.tipTotal ?? 0) + args.amount,
    })

    await ctx.db.insert("tipTransactions", {
      fromUserId: args.fromUserId,
      toUserId: args.toUserId,
      streamId: args.streamId,
      amount: args.amount,
      message: args.message?.trim() || undefined,
      solanaSignature: args.solanaSignature,
      tokenMint: args.tokenMint,
      createdAt: Date.now(),
    })

    await ctx.db.insert("tipAlerts", {
      streamId: args.streamId,
      fromUsername: args.fromUsername,
      amount: args.amount,
      message: args.message?.trim() || undefined,
      createdAt: Date.now(),
    })
  },
})

// ─── listMyTipHistory ────────────────────────────────────────────────────────

export const listMyTipHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthenticatedUser(ctx)

    const [sent, received] = await Promise.all([
      ctx.db
        .query("tipTransactions")
        .withIndex("by_from_user", (q) => q.eq("fromUserId", userId))
        .collect(),
      ctx.db
        .query("tipTransactions")
        .withIndex("by_to_user", (q) => q.eq("toUserId", userId))
        .collect(),
    ])

    // Build a set of counterparty user IDs to batch-fetch usernames
    const counterpartyIds = new Set<string>()
    for (const tx of sent) counterpartyIds.add(tx.toUserId)
    for (const tx of received) counterpartyIds.add(tx.fromUserId)

    const userMap = new Map<string, string>()
    for (const id of counterpartyIds) {
      const user = await ctx.db.get(id as typeof userId)
      userMap.set(id, user?.username ?? "Unknown")
    }

    type TipHistoryItem = {
      _id: string
      direction: "sent" | "received"
      counterpartyUsername: string
      amount: number
      message: string | undefined
      createdAt: number
    }

    const items: TipHistoryItem[] = [
      ...sent.map((tx) => ({
        _id: tx._id,
        direction: "sent" as const,
        counterpartyUsername: userMap.get(tx.toUserId) ?? "Unknown",
        amount: tx.amount,
        message: tx.message,
        createdAt: tx.createdAt,
      })),
      ...received.map((tx) => ({
        _id: tx._id,
        direction: "received" as const,
        counterpartyUsername: userMap.get(tx.fromUserId) ?? "Unknown",
        amount: tx.amount,
        message: tx.message,
        createdAt: tx.createdAt,
      })),
    ]

    items.sort((a, b) => b.createdAt - a.createdAt)

    return items
  },
})

// ─── withdraw ────────────────────────────────────────────────────────────────

export const withdraw = mutation({
  args: {
    amount: v.number(),
  },
  handler: async (ctx, { amount }) => {
    const userId = await getAuthenticatedUser(ctx)

    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid withdrawal amount")

    const user = await ctx.db.get(userId)
    if (!user) throw new Error("User not found")

    const balance = user.pointsBalance ?? 0
    if (balance < amount) throw new Error("Insufficient balance")

    // Deduct balance
    await ctx.db.patch(userId, { pointsBalance: balance - amount })

    return { success: true, newBalance: balance - amount }
  },
})

// ─── getStreamTipTotal ────────────────────────────────────────────────────────

export const getStreamTipTotal = query({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    const stream = await ctx.db.get(streamId)
    return stream?.tipTotal ?? 0
  },
})

// ─── listRecentAlerts ─────────────────────────────────────────────────────────

export const listRecentAlerts = query({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    return ctx.db
      .query("tipAlerts")
      .withIndex("by_stream", (q) => q.eq("streamId", streamId))
      .order("desc")
      .take(20)
  },
})
