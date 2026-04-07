import { v } from "convex/values"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"
import { api, internal } from "./_generated/api"
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

// ─── endStaleStreams ──────────────────────────────────────────────────────────
// Marks all non-ended streams for a user as ended. Called from goLive before
// creating a new stream to clean up stale records from previous failed attempts.

export const endStaleStreams = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const stale = await ctx.db
      .query("streams")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .filter((q) => q.neq(q.field("status"), "ended"))
      .collect()

    const now = Date.now()
    await Promise.all(
      stale.map((s) =>
        ctx.db.patch(s._id, { status: "ended", endedAt: now, viewerCount: 0 }),
      ),
    )
  },
})

// ─── create ───────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    title: v.string(),
    category: categoryValidator,
  },
  handler: async (ctx, { title, category }) => {
    const userId = await getAuthenticatedUser(ctx)

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
    const userId = await getAuthenticatedUser(ctx)

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
    const userId = await getAuthenticatedUser(ctx)

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
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return
    }
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
    // Always prefer a "live" stream — stale "starting" records from previous
    // failed attempts must never shadow an active broadcast.
    const live = await ctx.db
      .query("streams")
      .withIndex("by_username", (q) => q.eq("username", username))
      .filter((q) => q.eq(q.field("status"), "live"))
      .first()
    if (live) return live

    // Fallback: show the most recent "starting" stream (pre-broadcast spinner)
    return ctx.db
      .query("streams")
      .withIndex("by_username", (q) => q.eq("username", username))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "starting"))
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
      .order("desc")
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

// ─── listRecentStreams ────────────────────────────────────────────────────────

export const listRecentStreams = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 8

    const ended = await ctx.db
      .query("streams")
      .withIndex("by_status", (q) => q.eq("status", "ended"))
      .order("desc")
      .take(cap)

    if (ended.length === 0) return []

    const uniqueCreatorIds = [...new Set(ended.map((s) => s.creatorId))]
    const creators = await Promise.all(uniqueCreatorIds.map((id) => ctx.db.get(id)))
    const creatorById = new Map(uniqueCreatorIds.map((id, i) => [id, creators[i]]))

    return ended.map((stream) => ({
      stream,
      creator: creatorById.get(stream.creatorId) ?? null,
    }))
  },
})

// ─── goLive ───────────────────────────────────────────────────────────────────
// Starts an HLS livestream via the RTK REST API and marks the stream live in
// Convex with the playback URL returned directly by Cloudflare — no socket
// event polling required.

export const goLive = action({
  args: {
    title: v.string(),
    category: categoryValidator,
  },
  handler: async (ctx, { title, category }): Promise<{ streamId: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    // Resolve the Privy DID to a Convex user via getCurrentUser
    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!userRecord) throw new Error("Complete your profile before going live")
    const userId = userRecord._id

    const session = await ctx.runQuery(internal.streams.getActiveSessionForCreator, { userId })
    if (!session) throw new Error("No active studio session — open the studio first")

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
    if (!accountId || !apiToken || !appId) throw new Error("Cloudflare Realtime not configured")

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
    const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }

    // Clean up any stale non-ended streams from previous failed attempts so
    // getByUsername doesn't shadow the new stream on the viewer page.
    await ctx.runMutation(internal.streams.endStaleStreams, { userId })

    // Create the stream record and mark it as starting
    const streamId = await ctx.runMutation(api.streams.create, { title, category })
    await ctx.runMutation(api.streams.setStatus, { id: streamId, status: "starting" })

    try {
      // Start the HLS livestream on Cloudflare
      const startRes = await fetch(
        `${baseUrl}/meetings/${session.cloudflareRoomId}/livestreams`,
        { method: "POST", headers, body: JSON.stringify({}) },
      )
      if (!startRes.ok) {
        const body = await startRes.text()
        throw new Error(`Cloudflare livestream start failed: ${startRes.status} — ${body}`)
      }

      // Log full response to diagnose field names — Cloudflare RTK uses { data: ... }
      // for POST but may use { result: ... } for GET. Parse defensively.
      const startBody = await startRes.json()
      console.log("goLive: POST /livestreams response", JSON.stringify(startBody))

      // Try both data.playback_url and result.playback_url in case the wrapper differs
      const startData = (startBody as Record<string, Record<string, unknown>>).data
        ?? (startBody as Record<string, Record<string, unknown>>).result
      let playbackUrl: string | null = (startData?.playback_url as string) ?? null

      if (!playbackUrl) {
        const deadline = Date.now() + 30_000
        while (!playbackUrl && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500))
          const pollRes = await fetch(
            `${baseUrl}/meetings/${session.cloudflareRoomId}/active-livestream`,
            { headers: { Authorization: `Bearer ${apiToken}` } },
          )
          if (pollRes.ok) {
            const pollBody = await pollRes.json()
            console.log("goLive: GET /active-livestream poll", JSON.stringify(pollBody))
            const pollData = (pollBody as Record<string, Record<string, unknown>>).data
              ?? (pollBody as Record<string, Record<string, unknown>>).result
            playbackUrl = (pollData?.playback_url as string) ?? null
          }
        }
      }

      if (!playbackUrl) {
        throw new Error("Cloudflare did not return a playback URL within 30 s")
      }

      await ctx.runMutation(api.streams.setLive, { id: streamId, playbackUrl })

      // Fan out go-live notifications to all followers
      await ctx.runMutation(internal.notifications.fanOutGoLiveNotifications, {
        streamId,
        creatorId: userId,
        creatorName: userRecord?.displayName ?? userRecord?.username ?? "Creator",
        creatorUsername: userRecord?.username ?? "",
        streamTitle: title,
      })

      return { streamId }
    } catch (err) {
      // Roll back Convex record so the creator can retry
      await ctx.runMutation(api.streams.setStatus, { id: streamId, status: "ended", endedAt: Date.now() })
      throw err
    }
  },
})

// ─── listPastStreams ─────────────────────────────────────────────────────────
// Returns all ended streams for the authenticated user, ordered most-recent
// first. Used by the /dashboard/streams history page.

export const listPastStreams = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return []
    }

    const streams = await ctx.db
      .query("streams")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "ended"))
      .collect()

    return streams.map((s) => ({
      _id: s._id,
      title: s.title,
      category: s.category,
      viewerCount: s.viewerCount,
      peakViewerCount: s.peakViewerCount,
      tipTotal: s.tipTotal ?? 0,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      playbackUrl: s.playbackUrl,
    }))
  },
})

// ─── endLivestream ────────────────────────────────────────────────────────────

export const endLivestream = action({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!userRecord) throw new Error("Not authenticated")
    const userId = userRecord._id

    const session = await ctx.runQuery(internal.streams.getActiveSessionForCreator, { userId })
    if (!session) throw new Error("No active studio session")

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
    if (!accountId || !apiToken || !appId) throw new Error("Cloudflare Realtime not configured")

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`

    // Best-effort stop — swallow errors if there is no active livestream on Cloudflare
    try {
      await fetch(
        `${baseUrl}/meetings/${session.cloudflareRoomId}/active-livestream/stop`,
        { method: "POST", headers: { Authorization: `Bearer ${apiToken}` } },
      )
    } catch { /* no active stream on server */ }

    await ctx.runMutation(api.streams.setStatus, { id: streamId, status: "ended", endedAt: Date.now() })
  },
})
