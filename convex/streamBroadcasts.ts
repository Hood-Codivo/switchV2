import { v } from "convex/values"
import { action, internalMutation, internalQuery, query } from "./_generated/server"
import { api, internal } from "./_generated/api"

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
    cloudflareLiveOutputUid: v.optional(v.string()),
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

export const abandonBroadcast = action({
  args: { broadcastId: v.id("streamBroadcasts") },
  handler: async (ctx, { broadcastId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const broadcast = await ctx.runQuery(internal.streamBroadcasts.getById, { id: broadcastId })
    if (!broadcast) throw new Error("Broadcast not found")

    const stream = await ctx.runQuery(internal.streams.getStreamById, { id: broadcast.streamId })
    const user = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!user || !stream || stream.creatorId !== user._id) {
      throw new Error("Not authorized")
    }

    if (broadcast.platform === "youtube" && broadcast.externalBroadcastId) {
      const ytConn = await ctx.runQuery(
        internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
        { userId: user._id, platform: "youtube" },
      )
      if (ytConn) {
        try {
          await ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
            connectionId: ytConn._id,
            broadcastId: broadcast.externalBroadcastId,
            status: "complete",
          })
        } catch { /* best effort */ }
      }
    }

    if (broadcast.rtkRecordingId) {
      try {
        await ctx.runAction(internal.rtkRecordings.stopRecording, {
          recordingId: broadcast.rtkRecordingId,
        })
      } catch { /* best effort */ }
    }

    await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: broadcastId })
  },
})
