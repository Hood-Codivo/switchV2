import { v } from "convex/values"
import { internalMutation, mutation } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

const STALE_THRESHOLD_MS = 90_000
const MAX_VIEWERS_PER_STREAM = 10_000
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── recount ──────────────────────────────────────────────────────────────────
// Counts fresh presence records and syncs streams.viewerCount + peakViewerCount.
// Does NOT delete stale rows — physical cleanup is pruneStaleViewers' job.

async function recount(ctx: MutationCtx, streamId: Id<"streams">) {
  const cutoff = Date.now() - STALE_THRESHOLD_MS
  const all = await ctx.db
    .query("streamViewers")
    .withIndex("by_stream", (q) => q.eq("streamId", streamId))
    .collect()

  const liveCount = all.filter((r) => r.lastSeen > cutoff).length

  const stream = await ctx.db.get(streamId)
  if (!stream) return

  await ctx.db.patch(streamId, {
    viewerCount: liveCount,
    peakViewerCount: Math.max(stream.peakViewerCount, liveCount),
  })
}

// ─── join ─────────────────────────────────────────────────────────────────────

export const join = mutation({
  args: {
    streamId: v.id("streams"),
    sessionId: v.string(),
  },
  handler: async (ctx, { streamId, sessionId }) => {
    if (!UUID_REGEX.test(sessionId)) return

    const stream = await ctx.db.get(streamId)
    if (!stream || stream.status !== "live") return

    const existing = await ctx.db
      .query("streamViewers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: Date.now() })
    } else {
      // Cap total viewers per stream to prevent abuse
      const currentViewers = await ctx.db
        .query("streamViewers")
        .withIndex("by_stream", (q) => q.eq("streamId", streamId))
        .collect()
      if (currentViewers.length >= MAX_VIEWERS_PER_STREAM) return

      await ctx.db.insert("streamViewers", { streamId, sessionId, lastSeen: Date.now() })
    }

    await recount(ctx, streamId)
  },
})

// ─── heartbeat ────────────────────────────────────────────────────────────────

export const heartbeat = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    if (!UUID_REGEX.test(sessionId)) return

    const record = await ctx.db
      .query("streamViewers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first()

    if (!record) return

    await ctx.db.patch(record._id, { lastSeen: Date.now() })
    await recount(ctx, record.streamId)
  },
})

// ─── leave ────────────────────────────────────────────────────────────────────

export const leave = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    if (!UUID_REGEX.test(sessionId)) return

    const record = await ctx.db
      .query("streamViewers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first()

    if (!record) return

    const streamId = record.streamId
    await ctx.db.delete(record._id)
    await recount(ctx, streamId)
  },
})

// ─── pruneStaleViewers ────────────────────────────────────────────────────────
// Scheduled cleanup: deletes all stale presence records in a single sweep and
// recounts affected streams. Called by the cron job every minute.

export const pruneStaleViewers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_THRESHOLD_MS
    const stale = await ctx.db
      .query("streamViewers")
      .withIndex("by_last_seen", (q) => q.lte("lastSeen", cutoff))
      .collect()

    if (stale.length === 0) return

    // Delete all stale records in parallel
    await Promise.all(stale.map((r) => ctx.db.delete(r._id)))

    // Recount each affected stream once
    const affectedStreamIds = [...new Set(stale.map((r) => r.streamId))]
    await Promise.all(affectedStreamIds.map((id) => recount(ctx, id)))
  },
})
