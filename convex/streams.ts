import { v } from "convex/values"
import { internalQuery, mutation, query } from "./_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"
import { categoryValidator, streamStatusValidator } from "./schema"

// ─── getActiveSessionForCreator ───────────────────────────────────────────────

export const getActiveSessionForCreator = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) => q.eq("creatorId", userId).eq("status", "active"))
      .first()
  },
})

// ─── create ───────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    title: v.string(),
    category: categoryValidator,
  },
  handler: async (ctx, { title, category }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const user = await ctx.db.get(userId)
    if (!user?.username) throw new Error("Complete your profile before going live")

    return ctx.db.insert("streams", {
      creatorId: userId,
      username: user.username,
      title,
      category,
      status: "idle",
      viewerCount: 0,
      peakViewerCount: 0,
    })
  },
})

// ─── setLive ──────────────────────────────────────────────────────────────────

export const setLive = mutation({
  args: {
    id: v.id("streams"),
    playbackUrl: v.string(),
  },
  handler: async (ctx, { id, playbackUrl }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const stream = await ctx.db.get(id)
    if (!stream) throw new Error("Stream not found")
    if (stream.creatorId !== userId) throw new Error("Not authorized")

    await ctx.db.patch(id, {
      status: "live",
      playbackUrl,
      startedAt: Date.now(),
    })
  },
})

// ─── setStatus ────────────────────────────────────────────────────────────────
// "live" is intentionally excluded — use setLive to transition to live status,
// which enforces that playbackUrl is always present when status === "live".

const setStatusValidator = v.union(
  v.literal("idle"),
  v.literal("starting"),
  v.literal("ended"),
)

export const setStatus = mutation({
  args: {
    id: v.id("streams"),
    status: setStatusValidator,
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, status, endedAt }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const stream = await ctx.db.get(id)
    if (!stream) throw new Error("Stream not found")
    if (stream.creatorId !== userId) throw new Error("Not authorized")

    await ctx.db.patch(id, {
      status,
      ...(endedAt !== undefined ? { endedAt } : {}),
      // Zero viewer count immediately on end so the studio header and feed
      // don't show a stale count until the next pruneStaleViewers cron tick.
      ...(status === "ended" ? { viewerCount: 0 } : {}),
    })
  },
})

// ─── heartbeat ────────────────────────────────────────────────────────────────

export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) => q.eq("creatorId", userId).eq("status", "active"))
      .first()
    if (!session) return
    await ctx.db.patch(session._id, { lastHeartbeatAt: Date.now() })
  },
})

// ─── getByUsername ────────────────────────────────────────────────────────────

export const getByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    return ctx.db
      .query("streams")
      .withIndex("by_username", (q) => q.eq("username", username))
      .filter((q) => q.neq(q.field("status"), "ended"))
      .first()
  },
})

// ─── getActive ────────────────────────────────────────────────────────────────

export const getActive = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("streams")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "ended"),
          q.neq(q.field("status"), "idle"),
        ),
      )
      .first()
  },
})

// ─── listLiveStreams ───────────────────────────────────────────────────────────

export const listLiveStreams = query({
  args: {
    category: v.union(categoryValidator, v.null()),
    searchQuery: v.string(),
  },
  handler: async (ctx, { category, searchQuery }) => {
    const liveStreams = await ctx.db
      .query("streams")
      .withIndex("by_status", (q) => q.eq("status", "live"))
      .collect()

    const filtered = liveStreams.filter((stream) => {
      if (category && stream.category !== category) return false
      return true
    })

    // Sort by viewerCount descending (was implicit in old compound index)
    filtered.sort((a, b) => b.viewerCount - a.viewerCount)

    // Fetch each unique creator once — avoids redundant db.get calls when
    // multiple streams share the same creator.
    const uniqueCreatorIds = [...new Set(filtered.map((s) => s.creatorId))]
    const creators = await Promise.all(uniqueCreatorIds.map((id) => ctx.db.get(id)))
    const creatorById = new Map(uniqueCreatorIds.map((id, i) => [id, creators[i]]))

    const results = filtered.map((stream) => ({
      stream,
      creator: creatorById.get(stream.creatorId) ?? null,
    }))

    if (!searchQuery) return results

    const q = searchQuery.toLowerCase()
    return results.filter(
      ({ stream, creator }) =>
        stream.title.toLowerCase().startsWith(q) ||
        (creator?.username ?? "").toLowerCase().startsWith(q),
    )
  },
})
