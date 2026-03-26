import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
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

    if (amount <= 0 || !Number.isInteger(amount)) throw new Error("Invalid tip amount")

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
