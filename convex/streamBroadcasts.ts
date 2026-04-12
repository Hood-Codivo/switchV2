import { v } from "convex/values"
import { internalMutation, internalQuery, query } from "./_generated/server"

const platformValidator = v.union(v.literal("youtube"), v.literal("x"))
const privacyValidator = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
)

export const create = internalMutation({
  args: {
    streamId: v.id("streams"),
    platform: platformValidator,
    title: v.string(),
    description: v.string(),
    privacy: privacyValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("streamBroadcasts", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    })
  },
})

export const attachExternals = internalMutation({
  args: {
    id: v.id("streamBroadcasts"),
    externalBroadcastId: v.string(),
    externalStreamId: v.string(),
    rtkRecordingId: v.string(),
  },
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch(id, rest)
  },
})

export const markLive = internalMutation({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "live" })
  },
})

export const markDegraded = internalMutation({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "degraded", degradedSince: Date.now() })
  },
})

export const markEnded = internalMutation({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "ended", endedAt: Date.now() })
  },
})

export const markFailed = internalMutation({
  args: { id: v.id("streamBroadcasts"), errorMessage: v.string() },
  handler: async (ctx, { id, errorMessage }) => {
    await ctx.db.patch(id, { status: "failed", errorMessage, endedAt: Date.now() })
  },
})

export const listForStream = query({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    return ctx.db
      .query("streamBroadcasts")
      .withIndex("by_stream", (q) => q.eq("streamId", streamId))
      .collect()
  },
})

export const listActiveBroadcasts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const live = await ctx.db
      .query("streamBroadcasts")
      .withIndex("by_status", (q) => q.eq("status", "live"))
      .collect()
    const degraded = await ctx.db
      .query("streamBroadcasts")
      .withIndex("by_status", (q) => q.eq("status", "degraded"))
      .collect()
    return [...live, ...degraded]
  },
})

export const getById = internalQuery({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => ctx.db.get(id),
})
