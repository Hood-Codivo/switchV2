import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"

// ─── sendMessage ──────────────────────────────────────────────────────────────

export const sendMessage = mutation({
  args: {
    streamId: v.id("streams"),
    content: v.string(),
  },
  handler: async (ctx, { streamId, content }) => {
    const userId = await getAuthenticatedUser(ctx)

    const user = await ctx.db.get(userId)
    if (!user?.username) throw new Error("Complete your profile to chat")

    const stream = await ctx.db.get(streamId)
    if (!stream) throw new Error("Stream not found")
    if (stream.status !== "live") throw new Error("Chat is only available on live streams")

    // Check ban/timeout
    const moderations = await ctx.db
      .query("chatModerations")
      .withIndex("by_stream_and_user", (q) => q.eq("streamId", streamId).eq("userId", userId))
      .collect()

    for (const mod of moderations) {
      if (mod.type === "ban") {
        throw new Error("You are banned from this chat")
      }
      if (mod.type === "timeout" && mod.expiresAt && mod.expiresAt > Date.now()) {
        throw new Error("You are timed out from this chat")
      }
    }

    // Check slow mode
    if (stream.slowModeInterval && stream.slowModeInterval > 0 && stream.creatorId !== userId) {
      const recentMessage = await ctx.db
        .query("chatMessages")
        .withIndex("by_user_and_stream", (q) => q.eq("userId", userId).eq("streamId", streamId))
        .order("desc")
        .first()

      if (recentMessage) {
        const elapsed = (Date.now() - recentMessage.createdAt) / 1000
        if (elapsed < stream.slowModeInterval) {
          throw new Error(
            `Slow mode is on. Wait ${Math.ceil(stream.slowModeInterval - elapsed)}s before sending another message`,
          )
        }
      }
    }

    const trimmed = content.trim()
    if (trimmed.length === 0) throw new Error("Message cannot be empty")
    if (trimmed.length > 500) throw new Error("Message too long")

    return ctx.db.insert("chatMessages", {
      streamId,
      userId,
      username: user.username,
      content: trimmed,
      isHidden: false,
      createdAt: Date.now(),
    })
  },
})

// ─── listMessages ─────────────────────────────────────────────────────────────

export const listMessages = query({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    const stream = await ctx.db.get(streamId)
    const clearedAt = stream?.chatClearedAt ?? 0

    return ctx.db
      .query("chatMessages")
      .withIndex("by_stream_and_created", (q) =>
        q.eq("streamId", streamId).gt("createdAt", clearedAt),
      )
      .order("asc")
      .filter((q) => q.eq(q.field("isHidden"), false))
      .take(200)
  },
})

// ─── moderateUser ─────────────────────────────────────────────────────────────

export const moderateUser = mutation({
  args: {
    streamId: v.id("streams"),
    userId: v.id("users"),
    action: v.union(v.literal("ban"), v.literal("timeout")),
    duration: v.optional(v.number()), // seconds, for timeout only
  },
  handler: async (ctx, { streamId, userId, action, duration }) => {
    const callerId = await getAuthenticatedUser(ctx)

    const stream = await ctx.db.get(streamId)
    if (!stream) throw new Error("Stream not found")
    if (stream.creatorId !== callerId) throw new Error("Only the stream creator can moderate")

    // Replace any existing moderation for this user+stream instead of accumulating
    // duplicate records. A ban supersedes a timeout; a new timeout replaces the old.
    const existing = await ctx.db
      .query("chatModerations")
      .withIndex("by_stream_and_user", (q) => q.eq("streamId", streamId).eq("userId", userId))
      .collect()

    for (const mod of existing) {
      await ctx.db.delete(mod._id)
    }

    return ctx.db.insert("chatModerations", {
      streamId,
      userId,
      type: action,
      expiresAt: action === "timeout" && duration ? Date.now() + duration * 1000 : undefined,
      createdAt: Date.now(),
    })
  },
})

// ─── clearChat ────────────────────────────────────────────────────────────────

export const clearChat = mutation({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    const callerId = await getAuthenticatedUser(ctx)

    const stream = await ctx.db.get(streamId)
    if (!stream) throw new Error("Stream not found")
    if (stream.creatorId !== callerId) throw new Error("Only the stream creator can clear chat")

    // Stamp the stream with a chatClearedAt timestamp instead of patching
    // every message individually — O(1) regardless of message count.
    // listMessages filters out messages older than this timestamp.
    await ctx.db.patch(streamId, { chatClearedAt: Date.now() })
  },
})

// ─── setSlowMode ──────────────────────────────────────────────────────────────

export const setSlowMode = mutation({
  args: {
    streamId: v.id("streams"),
    interval: v.number(), // seconds, 0 = off
  },
  handler: async (ctx, { streamId, interval }) => {
    const callerId = await getAuthenticatedUser(ctx)

    const stream = await ctx.db.get(streamId)
    if (!stream) throw new Error("Stream not found")
    if (stream.creatorId !== callerId) throw new Error("Only the stream creator can set slow mode")

    await ctx.db.patch(streamId, { slowModeInterval: interval })
  },
})

// ─── getModerationState ───────────────────────────────────────────────────────

export const getModerationState = query({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return { banned: false, timedOutUntil: null }
    }

    const moderations = await ctx.db
      .query("chatModerations")
      .withIndex("by_stream_and_user", (q) => q.eq("streamId", streamId).eq("userId", userId))
      .collect()

    let banned = false
    let timedOutUntil: number | null = null

    for (const mod of moderations) {
      if (mod.type === "ban") banned = true
      if (mod.type === "timeout" && mod.expiresAt && mod.expiresAt > Date.now()) {
        timedOutUntil = mod.expiresAt
      }
    }

    return { banned, timedOutUntil }
  },
})
