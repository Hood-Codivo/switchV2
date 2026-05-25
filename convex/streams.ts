import { v } from "convex/values"
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"
import { api, internal } from "./_generated/api"
import { categoryValidator, streamBillingStateValidator, streamStatusValidator } from "./schema"
import {
  CHARGE_BLOCK_MINUTES,
  STREAM_RATE_PER_HOUR_USD,
  SWTD_USD_PRICE,
} from "../lib/stream-billing"

const MILLISECONDS_PER_MINUTE = 60_000
const GRACE_PERIOD_MS = 60_000

const streamSessionPlanValidator = v.object({
  plannedMinutes: v.number(),
  allowExtraUsageSpending: v.boolean(),
  overtimeMinutes: v.number(),
})

const simulcastArgValidator = v.optional(
  v.object({
    youtube: v.optional(
      v.object({
        title: v.string(),
        description: v.string(),
        privacy: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
      }),
    ),
    x: v.optional(v.boolean()),   // X has no per-broadcast metadata — just "on/off"
  }),
)

async function withRetryOnce<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/invalid_credentials|quota_exceeded/.test(msg)) throw e
    console.warn(`${label} failed once, retrying after 200ms: ${msg}`)
    await new Promise((r) => setTimeout(r, 200))
    return fn()
  }
}

function getObjectKeys(value: unknown): string[] {
  return value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : []
}

function getNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null

  const record = value as Record<string, unknown>
  const direct = record[key]
  if (typeof direct === "string" && direct.length > 0) return direct

  for (const child of Object.values(record)) {
    const nested = getNestedString(child, key)
    if (nested) return nested
  }

  return null
}

function getPlaybackUrl(value: unknown): string | null {
  return getNestedString(value, "playback_url") ?? getNestedString(value, "playbackUrl")
}

function getLivestreamId(value: unknown): string | null {
  return getNestedString(value, "id")
}

function summarizeUrl(value: string): Record<string, unknown> {
  try {
    const url = new URL(value)
    return {
      protocol: url.protocol,
      host: url.host,
      pathSegments: url.pathname.split("/").filter(Boolean).length,
      length: value.length,
      parseable: true,
    }
  } catch {
    return {
      startsWithRtmp: value.startsWith("rtmp://") || value.startsWith("rtmps://"),
      length: value.length,
      parseable: false,
    }
  }
}

function logGoLive(event: string, fields: Record<string, unknown> = {}) {
  console.info(`[goLive] ${event}`, fields)
}

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

export const getSessionForCreator = internalQuery({
  args: {
    userId: v.id("users"),
    sessionId: v.id("studioSessions"),
  },
  handler: async (ctx, { userId, sessionId }) => {
    const session = await ctx.db.get(sessionId)
    if (!session || session.creatorId !== userId || session.status !== "active") {
      return null
    }
    return session
  },
})

export const attachBillingPlanToSession = internalMutation({
  args: {
    sessionId: v.id("studioSessions"),
    billing: v.object({
      spendingLimitMinutes: v.number(),
      allowExtraUsageSpending: v.boolean(),
      spendingLimitUsd: v.number(),
      spendingLimitSwtdAmount: v.string(),
      billingState: streamBillingStateValidator,
      chargedMinutes: v.number(),
      remainingApprovedMinutes: v.number(),
      chargeBlockMinutes: v.number(),
      nextChargeAt: v.optional(v.number()),
      graceStartedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { sessionId, billing }) => {
    await ctx.db.patch(sessionId, billing)
  },
})

export const attachBillingPlanToStream = internalMutation({
  args: {
    streamId: v.id("streams"),
    billing: v.object({
      spendingLimitMinutes: v.number(),
      allowExtraUsageSpending: v.boolean(),
      spendingLimitUsd: v.number(),
      spendingLimitSwtdAmount: v.string(),
      billingState: streamBillingStateValidator,
      chargedMinutes: v.number(),
      remainingApprovedMinutes: v.number(),
      chargeBlockMinutes: v.number(),
      nextChargeAt: v.optional(v.number()),
      graceStartedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { streamId, billing }) => {
    await ctx.db.patch(streamId, billing)
  },
})

export const attachStreamToSession = internalMutation({
  args: {
    sessionId: v.id("studioSessions"),
    streamId: v.id("streams"),
  },
  handler: async (ctx, { sessionId, streamId }) => {
    await ctx.db.patch(sessionId, { streamId })
  },
})

export const clearStreamFromSession = internalMutation({
  args: {
    sessionId: v.id("studioSessions"),
  },
  handler: async (ctx, { sessionId }) => {
    await ctx.db.patch(sessionId, { streamId: undefined })
  },
})

export const markPrepaidChargeOnSession = internalMutation({
  args: {
    sessionId: v.id("studioSessions"),
    signature: v.string(),
    chargedAt: v.number(),
  },
  handler: async (ctx, { sessionId, signature, chargedAt }) => {
    await ctx.db.patch(sessionId, {
      spendingApprovedAt: chargedAt,
      spendingApprovalSignature: signature,
    })
  },
})

export const applyTopUpToActiveSession = internalMutation({
  args: {
    sessionId: v.id("studioSessions"),
    purchasedMinutes: v.number(),
  },
  handler: async (ctx, { sessionId, purchasedMinutes }) => {
    const session = await ctx.db.get(sessionId)
    if (!session) throw new Error("Session not found")

    const nextRemainingApprovedMinutes = (session.remainingApprovedMinutes ?? 0) + purchasedMinutes
    const nextSpendingLimitMinutes = (session.spendingLimitMinutes ?? 0) + purchasedMinutes
    const nextSpendingLimitUsd = (nextSpendingLimitMinutes / 60) * STREAM_RATE_PER_HOUR_USD
    const patch = {
      spendingLimitMinutes: nextSpendingLimitMinutes,
      spendingLimitUsd: nextSpendingLimitUsd,
      spendingLimitSwtdAmount: (nextSpendingLimitUsd / SWTD_USD_PRICE).toString(),
      remainingApprovedMinutes: nextRemainingApprovedMinutes,
      billingState: "active" as const,
      graceStartedAt: undefined as number | undefined,
      nextChargeAt: undefined as number | undefined,
    }

    await ctx.db.patch(sessionId, patch)

    if (session.streamId) {
      await ctx.db.patch(session.streamId, patch)
    }
  },
})

export const applyBillingHeartbeatState = internalMutation({
  args: {
    sessionId: v.id("studioSessions"),
    lastHeartbeatAt: v.number(),
    billing: v.object({
      spendingLimitMinutes: v.number(),
      allowExtraUsageSpending: v.boolean(),
      spendingLimitUsd: v.number(),
      spendingLimitSwtdAmount: v.string(),
      billingState: streamBillingStateValidator,
      chargedMinutes: v.number(),
      remainingApprovedMinutes: v.number(),
      chargeBlockMinutes: v.number(),
      nextChargeAt: v.optional(v.number()),
      graceStartedAt: v.optional(v.number()),
    }),
    exhausted: v.boolean(),
  },
  handler: async (ctx, { sessionId, lastHeartbeatAt, billing, exhausted }) => {
    const session = await ctx.db.get(sessionId)
    if (!session) throw new Error("Session not found")

    await ctx.db.patch(sessionId, {
      lastHeartbeatAt,
      ...billing,
    })

    if (session.streamId) {
      await ctx.db.patch(session.streamId, billing)
      if (exhausted) {
        await ctx.db.patch(session.streamId, {
          status: "ended",
          endedAt: lastHeartbeatAt,
          viewerCount: 0,
          billingState: "exhausted",
        })
      }
    }
  },
})

function applyBillingTick(
  state: {
    remainingApprovedMinutes: number
    chargedMinutes: number
    chargeBlockMinutes: number
    billingState?: "active" | "grace" | "exhausted" | "completed"
    nextChargeAt?: number
    graceStartedAt?: number
  },
  now: number,
) {
  let remainingApprovedMinutes = Math.max(0, state.remainingApprovedMinutes)
  let chargedMinutes = Math.max(0, state.chargedMinutes)
  let billingState = state.billingState ?? "active"
  let nextChargeAt = state.nextChargeAt
  let graceStartedAt = state.graceStartedAt

  if (billingState === "active") {
    if (!nextChargeAt) {
      const blockMinutes = Math.min(state.chargeBlockMinutes, remainingApprovedMinutes)
      if (blockMinutes > 0) {
        remainingApprovedMinutes = Math.max(0, remainingApprovedMinutes - blockMinutes)
        chargedMinutes += blockMinutes
        nextChargeAt = now + state.chargeBlockMinutes * MILLISECONDS_PER_MINUTE
      } else {
        billingState = "grace"
        graceStartedAt ??= now
      }
    }

    while (
      billingState === "active" &&
      nextChargeAt !== undefined &&
      now >= nextChargeAt
    ) {
      if (remainingApprovedMinutes <= 0) {
        billingState = "grace"
        nextChargeAt = undefined
        graceStartedAt ??= now
        break
      }

      const blockMinutes = Math.min(state.chargeBlockMinutes, remainingApprovedMinutes)
      remainingApprovedMinutes = Math.max(0, remainingApprovedMinutes - blockMinutes)
      chargedMinutes += blockMinutes
      nextChargeAt += state.chargeBlockMinutes * MILLISECONDS_PER_MINUTE
    }
  }

  if (billingState === "grace") {
    graceStartedAt ??= now
    if (now - graceStartedAt >= GRACE_PERIOD_MS) {
      billingState = "exhausted"
    }
  }

  return {
    billingState,
    chargedMinutes,
    remainingApprovedMinutes,
    nextChargeAt,
    graceStartedAt,
  }
}

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
    sessionPlan: v.optional(streamSessionPlanValidator),
  },
  handler: async (ctx, { title, category, sessionPlan: _sessionPlan }) => {
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

export const heartbeat = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return
    }

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!userRecord) return

    const session = await ctx.runQuery(internal.streams.getActiveSessionForCreator, {
      userId: userRecord._id,
    })
    if (!session) return

    const now = Date.now()
    const stream = session.streamId ? await ctx.runQuery(api.streams.getActive, { userId: userRecord._id }) : null

    if (!session.streamId || !stream || stream.status === "ended") {
      await ctx.runMutation(internal.streams.attachBillingPlanToSession, {
        sessionId: session._id,
        billing: {
          spendingLimitMinutes: session.spendingLimitMinutes ?? 0,
          allowExtraUsageSpending: session.allowExtraUsageSpending ?? false,
          spendingLimitUsd:
            session.spendingLimitUsd ?? ((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD,
          spendingLimitSwtdAmount:
            session.spendingLimitSwtdAmount
            ?? ((((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD) / SWTD_USD_PRICE).toString(),
          billingState: session.billingState ?? "active",
          chargedMinutes: session.chargedMinutes ?? 0,
          remainingApprovedMinutes: session.remainingApprovedMinutes ?? (session.spendingLimitMinutes ?? 0),
          chargeBlockMinutes: session.chargeBlockMinutes ?? CHARGE_BLOCK_MINUTES,
          nextChargeAt: session.nextChargeAt,
          graceStartedAt: session.graceStartedAt,
        },
      })
      await ctx.runMutation(internal.streams.applyBillingHeartbeatState, {
        sessionId: session._id,
        lastHeartbeatAt: now,
        billing: {
          spendingLimitMinutes: session.spendingLimitMinutes ?? 0,
          allowExtraUsageSpending: session.allowExtraUsageSpending ?? false,
          spendingLimitUsd:
            session.spendingLimitUsd ?? ((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD,
          spendingLimitSwtdAmount:
            session.spendingLimitSwtdAmount
            ?? ((((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD) / SWTD_USD_PRICE).toString(),
          billingState: session.billingState ?? "active",
          chargedMinutes: session.chargedMinutes ?? 0,
          remainingApprovedMinutes: session.remainingApprovedMinutes ?? (session.spendingLimitMinutes ?? 0),
          chargeBlockMinutes: session.chargeBlockMinutes ?? CHARGE_BLOCK_MINUTES,
          nextChargeAt: session.nextChargeAt,
          graceStartedAt: session.graceStartedAt,
        },
        exhausted: false,
      })
      return
    }

    let billingState = session.billingState ?? "active"
    let chargedMinutes = session.chargedMinutes ?? 0
    let remainingApprovedMinutes = session.remainingApprovedMinutes ?? (session.spendingLimitMinutes ?? 0)
    const chargeBlockMinutes = session.chargeBlockMinutes ?? CHARGE_BLOCK_MINUTES
    let nextChargeAt: number | undefined = session.nextChargeAt ?? now
    let graceStartedAt = session.graceStartedAt

    while (billingState === "active" && now >= nextChargeAt) {
      const blockMinutes = Math.min(chargeBlockMinutes, remainingApprovedMinutes)
      if (blockMinutes <= 0) {
        billingState = "grace"
        nextChargeAt = undefined
        graceStartedAt ??= now
        break
      }

      await ctx.runAction(api.serverPlatformWallet.chargeApprovedStreamBlock, {
        chargeMinutes: blockMinutes,
      })

      chargedMinutes += blockMinutes
      remainingApprovedMinutes = Math.max(0, remainingApprovedMinutes - blockMinutes)
      nextChargeAt += chargeBlockMinutes * MILLISECONDS_PER_MINUTE
    }

    if (billingState === "grace") {
      graceStartedAt ??= now
      if (now - graceStartedAt >= GRACE_PERIOD_MS) {
        billingState = "exhausted"
      }
    }

    const billingPatch = {
      spendingLimitMinutes: session.spendingLimitMinutes ?? 0,
      allowExtraUsageSpending: session.allowExtraUsageSpending ?? false,
      spendingLimitUsd:
        session.spendingLimitUsd ?? ((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD,
      spendingLimitSwtdAmount:
        session.spendingLimitSwtdAmount
        ?? ((((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD) / SWTD_USD_PRICE).toString(),
      billingState,
      chargedMinutes,
      remainingApprovedMinutes,
      chargeBlockMinutes,
      nextChargeAt,
      graceStartedAt,
    }

    await ctx.runMutation(internal.streams.attachBillingPlanToSession, {
      sessionId: session._id,
      billing: billingPatch,
    })
    await ctx.runMutation(internal.streams.applyBillingHeartbeatState, {
      sessionId: session._id,
      lastHeartbeatAt: now,
      billing: billingPatch,
      exhausted: billingState === "exhausted",
    })
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

export const getActiveBillingStatus = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return null
    }

    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first()

    if (!session) return null

    return {
      sessionId: session._id,
      streamId: session.streamId ?? null,
      billingState: session.billingState ?? "active",
      spendingLimitMinutes: session.spendingLimitMinutes ?? 0,
      allowExtraUsageSpending: session.allowExtraUsageSpending ?? false,
      chargedMinutes: session.chargedMinutes ?? 0,
      remainingApprovedMinutes: session.remainingApprovedMinutes ?? (session.spendingLimitMinutes ?? 0),
      chargeBlockMinutes: session.chargeBlockMinutes ?? CHARGE_BLOCK_MINUTES,
      nextChargeAt: session.nextChargeAt ?? null,
      graceStartedAt: session.graceStartedAt ?? null,
      spendingLimitUsd: session.spendingLimitUsd ?? ((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD,
      spendingLimitSwtdAmount:
        session.spendingLimitSwtdAmount
        ?? ((((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD) / SWTD_USD_PRICE).toString(),
      lastHeartbeatAt: session.lastHeartbeatAt ?? null,
    }
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
    sessionId: v.optional(v.id("studioSessions")),
    sessionPlan: v.optional(streamSessionPlanValidator),
    simulcast: simulcastArgValidator,
  },
  handler: async (
    ctx,
    { title, category, sessionId, sessionPlan, simulcast },
  ): Promise<{ streamId: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    // Resolve the Privy DID to a Convex user via getCurrentUser
    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!userRecord) throw new Error("Complete your profile before going live")
    const userId = userRecord._id

    const session = sessionId
      ? await ctx.runQuery(internal.streams.getSessionForCreator, { userId, sessionId })
      : await ctx.runQuery(internal.streams.getActiveSessionForCreator, { userId })
    if (!session) throw new Error("No active studio session — open the studio first")
    logGoLive("request received", {
      userId,
      sessionId: session._id,
      requestedSessionId: sessionId ?? null,
      cloudflareRoomId: session.cloudflareRoomId,
      category,
      titleLength: title.length,
      requestedPlannedMinutes: sessionPlan?.plannedMinutes ?? null,
      youtubeRequested: Boolean(simulcast?.youtube),
      xRequested: Boolean(simulcast?.x),
      sessionSpendingLimitMinutes: session.spendingLimitMinutes ?? 0,
      sessionRemainingApprovedMinutes: session.remainingApprovedMinutes ?? 0,
      sessionSpendingApprovedAt: session.spendingApprovedAt ?? null,
    })
    const billing = {
      spendingLimitMinutes: session.spendingLimitMinutes ?? 0,
      allowExtraUsageSpending: session.allowExtraUsageSpending ?? true,
      spendingLimitUsd:
        session.spendingLimitUsd ?? ((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD,
      spendingLimitSwtdAmount:
        session.spendingLimitSwtdAmount
        ?? ((((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD) / SWTD_USD_PRICE).toString(),
      billingState: "active" as const,
      chargedMinutes: 0,
      remainingApprovedMinutes: session.remainingApprovedMinutes ?? (session.spendingLimitMinutes ?? 0),
      chargeBlockMinutes: session.chargeBlockMinutes ?? CHARGE_BLOCK_MINUTES,
      nextChargeAt: Date.now(),
      graceStartedAt: undefined as number | undefined,
    }
    if (billing.spendingLimitMinutes < CHARGE_BLOCK_MINUTES) {
      throw new Error("Need at least 30 minutes worth of $SWTD to go live")
    }
    logGoLive("billing approved", {
      streamMinutes: billing.spendingLimitMinutes,
      remainingApprovedMinutes: billing.remainingApprovedMinutes,
      chargeBlockMinutes: billing.chargeBlockMinutes,
    })

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
    logGoLive("stream record created", { streamId })
    await ctx.runMutation(internal.streams.attachBillingPlanToSession, {
      sessionId: session._id,
      billing,
    })
    await ctx.runMutation(internal.streams.attachBillingPlanToStream, {
      streamId,
      billing,
    })

    try {
      // Start the HLS livestream on Cloudflare
      logGoLive("rtk livestream start request", {
        cloudflareRoomId: session.cloudflareRoomId,
      })
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
      logGoLive("rtk livestream start response", {
        status: startRes.status,
        topLevelKeys: getObjectKeys(startBody),
        dataKeys: getObjectKeys((startBody as Record<string, unknown>).data),
        resultKeys: getObjectKeys((startBody as Record<string, unknown>).result),
      })

      const livestreamId = getLivestreamId(startBody)
      let playbackUrl = getPlaybackUrl(startBody)
      logGoLive("playback url initial check", {
        playbackUrlPresent: Boolean(playbackUrl),
        livestreamIdPresent: Boolean(livestreamId),
      })

      if (!playbackUrl) {
        const deadline = Date.now() + 90_000
        while (!playbackUrl && Date.now() < deadline) {
          const pollPaths = [
            `/meetings/${session.cloudflareRoomId}/active-livestream`,
            ...(livestreamId
              ? [
                  `/livestreams/${livestreamId}`,
                  `/livestreams/${livestreamId}/active-livestream-session`,
                ]
              : []),
          ]

          for (const path of pollPaths) {
            const pollRes = await fetch(
              `${baseUrl}${path}`,
              { headers: { Authorization: `Bearer ${apiToken}` } },
            )
            if (pollRes.ok) {
              const pollBody = await pollRes.json()
              playbackUrl = getPlaybackUrl(pollBody)
              logGoLive("rtk livestream poll", {
                status: pollRes.status,
                path,
                playbackUrlPresent: Boolean(playbackUrl),
                topLevelKeys: getObjectKeys(pollBody),
                dataKeys: getObjectKeys((pollBody as Record<string, unknown>).data),
                resultKeys: getObjectKeys((pollBody as Record<string, unknown>).result),
              })
              if (playbackUrl) break
            } else {
              logGoLive("rtk livestream poll failed", {
                status: pollRes.status,
                path,
              })
            }
          }

          if (!playbackUrl) await new Promise((r) => setTimeout(r, 1500))
        }
      }

      if (!playbackUrl) {
        throw new Error("Cloudflare did not return a playback URL within 90 s")
      }

      await ctx.runMutation(api.streams.setLive, { id: streamId, playbackUrl })
      await ctx.runMutation(internal.streams.attachStreamToSession, {
        sessionId: session._id,
        streamId,
      })
      logGoLive("switched stream marked live", {
        streamId,
        playbackUrlPresent: true,
      })

      // ── Simulcast orchestration (v3: via Cloudflare Stream Live Input) ──
      const destinations: Array<
        | { kind: "youtube"; payload: { title: string; description: string; privacy: "public" | "unlisted" | "private" } }
        | { kind: "x" }
      > = []
      if (simulcast?.youtube) destinations.push({ kind: "youtube", payload: simulcast.youtube })
      if (simulcast?.x) destinations.push({ kind: "x" })
      logGoLive("simulcast destinations resolved", {
        destinations: destinations.map((destination) => destination.kind),
      })

      if (destinations.length > 0) {
        await ctx.runMutation(api.streams.setSimulcastEnabled, { id: streamId, enabled: true })

        // 1. Provision (or reuse) the per-creator Cloudflare Stream Live Input
        logGoLive("cloudflare live input ensure request", {
          userId,
          displayName: userRecord.username ?? "creator",
        })
        const liveInput = await ctx.runAction(internal.cloudflareStream.ensureLiveInput, {
          userId,
          displayName: userRecord.username ?? "creator",
        })
        const liveInputRtmpWithKey = `${liveInput.rtmpsUrl}${liveInput.streamKey}`
        logGoLive("cloudflare live input ready", {
          liveInputUid: liveInput.liveInputUid,
          ingestUrl: summarizeUrl(liveInput.rtmpsUrl),
          streamKeyLength: liveInput.streamKey.length,
          combinedIngestLength: liveInputRtmpWithKey.length,
        })

        // 2. Start RealtimeKit /recordings pointing at the Live Input
        let recordingId: string | null = null
        try {
          logGoLive("rtk recording start request", {
            cloudflareRoomId: session.cloudflareRoomId,
            destination: summarizeUrl(liveInput.rtmpsUrl),
          })
          const rec = await withRetryOnce(
            () => ctx.runAction(internal.rtkRecordings.startRtmpRecording, {
              meetingId: session.cloudflareRoomId,
              rtmpUrlWithKey: liveInputRtmpWithKey,
            }),
            "rtk.startRtmpRecording",
          )
          recordingId = rec.recordingId
          logGoLive("rtk recording started", {
            recordingId,
            liveInputUid: liveInput.liveInputUid,
          })
          if (process.env.SWITCHED_DEBUG_SIMULCAST_STATUS === "true") {
            try {
              const liveInputStatus = await ctx.runAction(internal.cloudflareStream.inspectLiveInput, {
                liveInputUid: liveInput.liveInputUid,
              })
              logGoLive("cloudflare live input status after rtk start", {
                liveInputUid: liveInput.liveInputUid,
                status: liveInputStatus.status,
              })
            } catch (statusError) {
              console.warn("[goLive] cloudflare live input status check failed", statusError)
            }
          } else {
            logGoLive("cloudflare live input status probe skipped", {
              liveInputUid: liveInput.liveInputUid,
              enableWith: "SWITCHED_DEBUG_SIMULCAST_STATUS=true",
            })
          }
        } catch (e) {
          console.error("RealtimeKit /recordings failed, no simulcast this stream:", e)
          // Stream stays live on Switched; no simulcast rows created.
          recordingId = null
        }

        if (recordingId !== null) {
          // 3. Per-destination loop
          for (const dest of destinations) {
            const broadcastId = await ctx.runMutation(internal.streamBroadcasts.create, {
              streamId,
              platform: dest.kind,
              title: dest.kind === "youtube" ? dest.payload.title : "",
              description: dest.kind === "youtube" ? dest.payload.description : "",
              privacy: dest.kind === "youtube" ? dest.payload.privacy : "public",
            })
            logGoLive("simulcast broadcast created", {
              broadcastId,
              platform: dest.kind,
              recordingId,
              liveInputUid: liveInput.liveInputUid,
            })

            try {
              if (dest.kind === "youtube") {
                const ytConnection = await ctx.runQuery(
                  internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
                  { userId, platform: "youtube" },
                )
                logGoLive("youtube connection checked", {
                  broadcastId,
                  status: ytConnection?.status ?? "missing",
                  hasAccessToken: Boolean(ytConnection?.accessToken),
                })
                if (!ytConnection || ytConnection.status !== "active") {
                  throw new Error("YouTube not connected or token expired")
                }
                const ytResult = await withRetryOnce(
                  () => ctx.runAction(internal.youtubeBroadcasts.createBroadcast, {
                    connectionId: ytConnection._id,
                    title: dest.payload.title,
                    description: dest.payload.description,
                    privacy: dest.payload.privacy,
                  }),
                  "youtube.createBroadcast",
                )
                logGoLive("youtube broadcast created", {
                  broadcastId,
                  externalBroadcastId: ytResult.broadcastId,
                  externalStreamId: ytResult.streamId,
                  destination: summarizeUrl(ytResult.rtmpUrl),
                  streamKeyLength: ytResult.streamKey.length,
                })

                const output = await withRetryOnce(
                  () => ctx.runAction(internal.cloudflareStream.createSimulcastOutput, {
                    liveInputUid: liveInput.liveInputUid,
                    destinationUrl: ytResult.rtmpUrl,
                    destinationStreamKey: ytResult.streamKey,
                  }),
                  "cf.createSimulcastOutput(youtube)",
                )
                logGoLive("youtube cloudflare output created", {
                  broadcastId,
                  outputUid: output.outputUid,
                  liveInputUid: liveInput.liveInputUid,
                })

                await ctx.runMutation(internal.streamBroadcasts.attachExternals, {
                  id: broadcastId,
                  externalBroadcastId: ytResult.broadcastId,
                  externalStreamId: ytResult.streamId,
                  rtkRecordingId: recordingId,
                  cloudflareLiveOutputUid: output.outputUid,
                })

                await withRetryOnce(
                  () => ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
                    connectionId: ytConnection._id,
                    broadcastId: ytResult.broadcastId,
                    status: "live",
                  }),
                  "youtube.transition-live",
                )
                logGoLive("youtube broadcast transitioned live", {
                  broadcastId,
                  externalBroadcastId: ytResult.broadcastId,
                })
              } else {
                // X (manual RTMP) — call action that decrypts credentials
                const xCreds = await ctx.runAction(
                  internal.connectedPlatformsActions.getXRtmpCredentials,
                  { userId },
                )
                logGoLive("x credentials checked", {
                  broadcastId,
                  connected: Boolean(xCreds),
                  destination: xCreds ? summarizeUrl(xCreds.rtmpUrl) : null,
                  streamKeyLength: xCreds?.streamKey.length ?? 0,
                })
                if (!xCreds) {
                  throw new Error("X not connected")
                }
                const output = await withRetryOnce(
                  () => ctx.runAction(internal.cloudflareStream.createSimulcastOutput, {
                    liveInputUid: liveInput.liveInputUid,
                    destinationUrl: xCreds.rtmpUrl,
                    destinationStreamKey: xCreds.streamKey,
                  }),
                  "cf.createSimulcastOutput(x)",
                )
                logGoLive("x cloudflare output created", {
                  broadcastId,
                  outputUid: output.outputUid,
                  liveInputUid: liveInput.liveInputUid,
                })
                await ctx.runMutation(internal.streamBroadcasts.attachExternals, {
                  id: broadcastId,
                  externalBroadcastId: "",             // X has no broadcast id
                  externalStreamId: "",
                  rtkRecordingId: recordingId,
                  cloudflareLiveOutputUid: output.outputUid,
                })
              }

              await ctx.runMutation(internal.streamBroadcasts.markLive, { id: broadcastId })
              logGoLive("simulcast broadcast marked live", {
                broadcastId,
                platform: dest.kind,
              })
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              console.error(`${dest.kind} simulcast failed, marking failed:`, msg)
              await ctx.runMutation(internal.streamBroadcasts.markFailed, {
                id: broadcastId,
                errorMessage: msg,
              })
            }
          }
        }
      }
      // ── End simulcast orchestration (v3) ─────────────────────────────────

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

// ─── setSimulcastEnabled ─────────────────────────────────────────────────────
// Marks a stream as having simulcast enabled. Called from the goLive action
// via ctx.runMutation (requires a public mutation so api.streams.setSimulcastEnabled
// is accessible from within actions).

export const setSimulcastEnabled = mutation({
  args: { id: v.id("streams"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ctx.db.patch(id, { simulcastEnabled: enabled })
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

// ─── performTeardown ─────────────────────────────────────────────────────────
// Internal action extracted so both endLivestream and the Task-7 webhook handler
// (teardownByRtkMeeting) can reuse the same best-effort tear-down logic.

export const performTeardown = internalAction({
  args: { streamId: v.id("streams"), userId: v.id("users"), cloudflareRoomId: v.string() },
  handler: async (ctx, { streamId, userId, cloudflareRoomId }): Promise<void> => {
    const broadcasts = await ctx.runQuery(api.streamBroadcasts.listForStream, { streamId })

    // Look up the creator's Cloudflare Live Input so we can delete Live Outputs.
    const creatorLiveInput = await ctx.runQuery(internal.creatorLiveInputs.getForUser, { userId })

    // Collect unique recording ids to deduplicate stopRecording calls.
    // In v3, a single RTK recording feeds multiple broadcast destinations, so we
    // must stop each recording id exactly once regardless of how many broadcasts
    // share it.
    const stoppedRecordingIds = new Set<string>()

    for (const b of broadcasts) {
      if (b.status !== "live" && b.status !== "degraded") continue

      if (b.platform === "youtube" && b.externalBroadcastId) {
        const ytConn = await ctx.runQuery(
          internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
          { userId, platform: "youtube" },
        )
        if (ytConn) {
          try {
            await ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
              connectionId: ytConn._id,
              broadcastId: b.externalBroadcastId,
              status: "complete",
            })
          } catch (e) {
            console.warn("YouTube transition complete (best-effort):", e)
          }
        }
      }

      // Delete the Cloudflare Stream Live Output for this broadcast (best-effort).
      if (b.cloudflareLiveOutputUid && creatorLiveInput) {
        try {
          await ctx.runAction(internal.cloudflareStream.removeSimulcastOutput, {
            liveInputUid: creatorLiveInput.cloudflareLiveInputUid,
            outputUid: b.cloudflareLiveOutputUid,
          })
        } catch (e) {
          console.warn("Cloudflare deleteLiveOutput (best-effort):", e)
        }
      }

      // Stop the RTK recording once per unique recording id.
      if (b.rtkRecordingId && !stoppedRecordingIds.has(b.rtkRecordingId)) {
        stoppedRecordingIds.add(b.rtkRecordingId)
        try {
          await ctx.runAction(internal.rtkRecordings.stopRecording, {
            recordingId: b.rtkRecordingId,
          })
        } catch (e) {
          console.warn("RealtimeKit stopRecording (best-effort):", e)
        }
      }

      await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: b._id })
    }

    // Stop the RealtimeKit livestream if a meeting id was provided.
    if (cloudflareRoomId) {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
      const apiToken = process.env.CLOUDFLARE_API_TOKEN
      const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
      if (accountId && apiToken && appId) {
        const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
        try {
          await fetch(`${base}/meetings/${cloudflareRoomId}/active-livestream/stop`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}` },
          })
        } catch { /* best effort */ }
      }
    }
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

    await ctx.runAction(internal.streams.performTeardown, {
      streamId,
      userId,
      cloudflareRoomId: session.cloudflareRoomId,
    })

    await ctx.runMutation(api.streams.setStatus, {
      id: streamId,
      status: "ended",
      endedAt: Date.now(),
    })

    await ctx.runMutation(internal.streams.attachBillingPlanToSession, {
      sessionId: session._id,
      billing: {
        spendingLimitMinutes: session.spendingLimitMinutes ?? 0,
        allowExtraUsageSpending: session.allowExtraUsageSpending ?? false,
        spendingLimitUsd:
          session.spendingLimitUsd ?? ((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD,
        spendingLimitSwtdAmount:
          session.spendingLimitSwtdAmount
          ?? ((((session.spendingLimitMinutes ?? 0) / 60) * STREAM_RATE_PER_HOUR_USD) / SWTD_USD_PRICE).toString(),
        billingState: "completed",
        chargedMinutes: session.chargedMinutes ?? 0,
        remainingApprovedMinutes: session.remainingApprovedMinutes ?? 0,
        chargeBlockMinutes: session.chargeBlockMinutes ?? CHARGE_BLOCK_MINUTES,
        nextChargeAt: undefined,
        graceStartedAt: undefined,
      },
    })
    await ctx.runMutation(internal.streams.clearStreamFromSession, {
      sessionId: session._id,
    })
  },
})

// ─── getSessionByRoomId ───────────────────────────────────────────────────────
// Used by webhook handler to look up the session from a RealtimeKit meeting id.

export const getSessionByRoomId = internalQuery({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }) => {
    return ctx.db
      .query("studioSessions")
      .filter((q) => q.eq(q.field("cloudflareRoomId"), cloudflareRoomId))
      .first()
  },
})

// ─── getStreamById ────────────────────────────────────────────────────────────
// Internal query to fetch a stream by id; used by webhook-triggered teardown.

export const getStreamById = internalQuery({
  args: { id: v.id("streams") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id)
  },
})

// ─── teardownByRtkMeeting ─────────────────────────────────────────────────────
// Called by the RealtimeKit `meeting.ended` webhook event. Finds the session,
// guards against already-ended streams, delegates to performTeardown, then
// marks the stream as ended.

export const teardownByRtkMeeting = internalAction({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }): Promise<void> => {
    const session = await ctx.runQuery(internal.streams.getSessionByRoomId, { cloudflareRoomId })
    if (!session?.streamId) return
    const stream = await ctx.runQuery(internal.streams.getStreamById, { id: session.streamId })
    if (!stream || stream.status === "ended") return

    await ctx.runAction(internal.streams.performTeardown, {
      streamId: session.streamId,
      userId: stream.creatorId,
      cloudflareRoomId,
    })
    await ctx.runMutation(api.streams.setStatus, {
      id: session.streamId,
      status: "ended",
      endedAt: Date.now(),
    })
  },
})

// ─── cleanupOrphanBroadcasts ─────────────────────────────────────────────────
// Safety cron (5 min) that sweeps active broadcasts and fixes any that are
// orphaned: stream deleted, stream ended without simulcast teardown, or stuck
// in degraded state for >10 minutes.

export const cleanupOrphanBroadcasts = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const active = await ctx.runQuery(internal.streamBroadcasts.listActiveBroadcasts, {})
    for (const b of active) {
      const stream = await ctx.runQuery(internal.streams.getStreamById, { id: b.streamId })
      if (!stream) {
        await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: b._id })
        continue
      }
      if (stream.status === "ended") {
        await ctx.runAction(internal.streams.performTeardown, {
          streamId: stream._id,
          userId: stream.creatorId,
          cloudflareRoomId: "",
        })
        continue
      }
      if (b.status === "degraded" && b.degradedSince && Date.now() - b.degradedSince > 10 * 60_000) {
        await ctx.runMutation(internal.streamBroadcasts.markFailed, {
          id: b._id,
          errorMessage: "simulcast degraded for >10m",
        })
      }
    }
  },
})

// ─── markSimulcastDegradedByRtkMeeting ───────────────────────────────────────
// Called by the RealtimeKit `livestreaming.statusUpdate → OFFLINE` webhook event.
// Marks all live broadcasts for the stream as degraded.

export const markSimulcastDegradedByRtkMeeting = internalAction({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }): Promise<void> => {
    const session = await ctx.runQuery(internal.streams.getSessionByRoomId, { cloudflareRoomId })
    if (!session?.streamId) return
    const broadcasts = await ctx.runQuery(api.streamBroadcasts.listForStream, {
      streamId: session.streamId,
    })
    for (const b of broadcasts) {
      if (b.status === "live") {
        await ctx.runMutation(internal.streamBroadcasts.markDegraded, { id: b._id })
      }
    }
  },
})
