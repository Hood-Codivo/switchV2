import { v } from "convex/values"
import { action, internalMutation, query } from "./_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"

// ─── Queries ────────────────────────────────────────────────────────────────

export const getActiveSession = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    return ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first()
  },
})

// ─── Internal mutations (called from actions only) ──────────────────────────

export const storeStudioSession = internalMutation({
  args: {
    creatorId: v.id("users"),
    cloudflareRoomId: v.string(),
    creatorAuthToken: v.string(),
  },
  handler: async (ctx, { creatorId, cloudflareRoomId, creatorAuthToken }) => {
    // End any existing active session first
    const existing = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", creatorId).eq("status", "active"),
      )
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { status: "ended" })
    }

    return ctx.db.insert("studioSessions", {
      creatorId,
      cloudflareRoomId,
      creatorAuthToken,
      status: "active",
      createdAt: Date.now(),
    })
  },
})

export const endStudioSessionRecord = internalMutation({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", creatorId).eq("status", "active"),
      )
      .first()
    if (!session) return
    await ctx.db.patch(session._id, { status: "ended" })
  },
})

// ─── Actions (call external Cloudflare Realtime API) ────────────────────────

export const createStudioSession = action({
  args: {},
  handler: async (ctx): Promise<{ authToken: string; roomId: string }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const appId = process.env.CLOUDFLARE_REALTIME_APP_ID
    const appSecret = process.env.CLOUDFLARE_REALTIME_APP_SECRET
    if (!appId || !appSecret) throw new Error("Cloudflare Realtime not configured")

    // Create a meeting room
    const meetingRes = await fetch(
      `https://rtk.realtime.cloudflare.com/v2/apps/${appId}/meetings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    )
    if (!meetingRes.ok) {
      throw new Error(`Failed to create CF meeting: ${meetingRes.status}`)
    }
    const meeting = (await meetingRes.json()) as { id: string }

    // Create a participant token for the creator
    const participantRes = await fetch(
      `https://rtk.realtime.cloudflare.com/v2/apps/${appId}/meetings/${meeting.id}/participants`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientSpecificId: userId }),
      },
    )
    if (!participantRes.ok) {
      throw new Error(`Failed to create CF participant: ${participantRes.status}`)
    }
    const participant = (await participantRes.json()) as { token: string }

    // Persist to DB via internalMutation
    await ctx.runMutation(internal.studio.storeStudioSession, {
      creatorId: userId as Id<"users">,
      cloudflareRoomId: meeting.id,
      creatorAuthToken: participant.token,
    })

    return { authToken: participant.token, roomId: meeting.id }
  },
})

export const endStudioSession = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    await ctx.runMutation(internal.studio.endStudioSessionRecord, {
      creatorId: userId as Id<"users">,
    })
  },
})
