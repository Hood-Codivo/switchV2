import { v } from "convex/values"
import { action, internalMutation, mutation, query } from "./_generated/server"
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

export const generateInviteToken = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first()
    if (!session) throw new Error("No active studio session")

    const token = crypto.randomUUID()
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    await ctx.db.patch(session._id, { inviteToken: token, inviteTokenExpiresAt: expiresAt })
    return token
  },
})

// ─── Actions (call external Cloudflare Realtime API) ────────────────────────

export const createStudioSession = action({
  args: {},
  handler: async (ctx): Promise<{ authToken: string; roomId: string }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
    if (!accountId || !apiToken || !appId) throw new Error("Cloudflare Realtime not configured")

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    }

    // Create a meeting room
    const meetingRes = await fetch(`${baseUrl}/meetings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Switched Studio" }),
    })
    if (!meetingRes.ok) {
      const body = await meetingRes.text()
      throw new Error(`Failed to create meeting: ${meetingRes.status} — ${body}`)
    }
    const meetingBody = (await meetingRes.json()) as { data: { id: string } }
    const meetingId = meetingBody.data.id

    // Create a participant token for the creator.
    // preset_name selects the permissions preset — default presets are created
    // automatically when you create the app in the Cloudflare dashboard.
    const participantRes = await fetch(`${baseUrl}/meetings/${meetingId}/participants`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Creator",
        preset_name: "livestream_host",
        custom_participant_id: userId,
      }),
    })
    if (!participantRes.ok) {
      const body = await participantRes.text()
      throw new Error(`Failed to create participant: ${participantRes.status} — ${body}`)
    }
    const participantBody = (await participantRes.json()) as { data: { token: string } }
    const participant = participantBody.data

    // Persist to DB via internalMutation
    await ctx.runMutation(internal.studio.storeStudioSession, {
      creatorId: userId as Id<"users">,
      cloudflareRoomId: meetingId,
      creatorAuthToken: participant.token,
    })

    return { authToken: participant.token, roomId: meetingId }
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
