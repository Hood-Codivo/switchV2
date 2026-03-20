import { v } from "convex/values"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
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

export const getSessionByInviteToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ sessionId: Id<"studioSessions">; expired: boolean } | null> => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first()
    if (!session) return null
    const expired = (session.inviteTokenExpiresAt ?? 0) < Date.now()
    return { sessionId: session._id, expired }
  },
})

export const listSessionGuests = query({
  args: { sessionId: v.id("studioSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const session = await ctx.db.get(sessionId)
    if (!session || session.creatorId !== userId) throw new Error("Not authorized")

    return ctx.db
      .query("studioGuests")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect()
  },
})

export const getGuestStatus = query({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => {
    return ctx.db.get(guestId)
  },
})

export const rejectGuest = mutation({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const guest = await ctx.db.get(guestId)
    if (!guest) throw new Error("Guest not found")

    const session = await ctx.db.get(guest.sessionId)
    if (!session || session.creatorId !== userId) throw new Error("Not authorized")

    await ctx.db.patch(guestId, { status: "rejected" })
  },
})

export const removeGuest = mutation({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const guest = await ctx.db.get(guestId)
    if (!guest) throw new Error("Guest not found")

    const session = await ctx.db.get(guest.sessionId)
    if (!session || session.creatorId !== userId) throw new Error("Not authorized")

    await ctx.db.patch(guestId, { status: "removed" })
  },
})

export const requestGuestJoin = mutation({
  args: { token: v.string(), displayName: v.string() },
  handler: async (ctx, { token, displayName }): Promise<Id<"studioGuests">> => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first()
    if (!session) throw new Error("Invalid invite token")
    if ((session.inviteTokenExpiresAt ?? 0) < Date.now()) throw new Error("Invite token has expired")

    return ctx.db.insert("studioGuests", {
      sessionId: session._id,
      displayName: displayName.trim().slice(0, 40),
      status: "waiting",
      createdAt: Date.now(),
    })
  },
})

// ─── Internal helpers ────────────────────────────────────────────────────────

export const getGuestWithSession = internalQuery({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => {
    const guest = await ctx.db.get(guestId)
    if (!guest) return null
    const session = await ctx.db.get(guest.sessionId)
    if (!session) return null
    return { ...guest, session }
  },
})

export const admitGuestRecord = internalMutation({
  args: { guestId: v.id("studioGuests"), rtkAuthToken: v.string() },
  handler: async (ctx, { guestId, rtkAuthToken }): Promise<void> => {
    await ctx.db.patch(guestId, { status: "admitted", rtkAuthToken })
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

export const admitGuest = action({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    // Verify the caller owns the session this guest belongs to
    const guest = await ctx.runQuery(internal.studio.getGuestWithSession, { guestId })
    if (!guest) throw new Error("Guest not found")
    if (guest.session.creatorId !== userId) throw new Error("Not authorized")

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
    if (!accountId || !apiToken || !appId) throw new Error("Cloudflare Realtime not configured")

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
    const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }

    const res = await fetch(
      `${baseUrl}/meetings/${guest.session.cloudflareRoomId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: guest.displayName,
          preset_name: "livestream_guest",
          custom_participant_id: guestId,
        }),
      },
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Failed to create guest participant: ${res.status} — ${body}`)
    }
    const { data } = (await res.json()) as { data: { token: string } }

    await ctx.runMutation(internal.studio.admitGuestRecord, {
      guestId,
      rtkAuthToken: data.token,
    })
  },
})
