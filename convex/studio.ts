import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAuthenticatedUser } from "./auth";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

function getCloudflareRealtimeConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID;
  const missing = [
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["CLOUDFLARE_API_TOKEN or CLOUDFLARE_STREAM_API_TOKEN", apiToken],
    ["CLOUDFLARE_REALTIMEKIT_APP_ID", appId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Cloudflare Realtime not configured. Missing Convex env: ${missing.join(", ")}`,
    );
  }

  return { accountId, apiToken, appId };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export const getActiveSession = query({
  args: {},
  handler: async (ctx) => {
    let userId;
    try {
      userId = await getAuthenticatedUser(ctx);
    } catch {
      return null;
    }

    return ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first();
  },
});

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
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "ended" });
    }

    return ctx.db.insert("studioSessions", {
      creatorId,
      cloudflareRoomId,
      creatorAuthToken,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const endStudioSessionRecord = internalMutation({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", creatorId).eq("status", "active"),
      )
      .first();
    if (!session) return;
    await ctx.db.patch(session._id, { status: "ended" });

    const messages = await ctx.db
      .query("backstageMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    await Promise.all(messages.map((m) => ctx.db.delete(m._id)));
  },
});

export const generateInviteToken = mutation({
  args: { expiresInHours: v.optional(v.number()) },
  handler: async (ctx, { expiresInHours = 24 }): Promise<string> => {
    const userId = await getAuthenticatedUser(ctx);

    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first();
    if (!session) throw new Error("No active studio session");

    const token = crypto.randomUUID();
    const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;
    await ctx.db.patch(session._id, {
      inviteToken: token,
      inviteTokenExpiresAt: expiresAt,
    });
    return token;
  },
});

export const getSessionByInviteToken = query({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<{ sessionId: Id<"studioSessions">; expired: boolean } | null> => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first();
    if (!session) return null;
    const expired = (session.inviteTokenExpiresAt ?? 0) < Date.now();
    return { sessionId: session._id, expired };
  },
});

export const listSessionGuests = query({
  args: { sessionId: v.id("studioSessions") },
  handler: async (ctx, { sessionId }) => {
    let userId;
    try {
      userId = await getAuthenticatedUser(ctx);
    } catch {
      return [];
    }

    const session = await ctx.db.get(sessionId);
    if (!session || session.creatorId !== userId) return [];

    return ctx.db
      .query("studioGuests")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect();
  },
});

// Security note: this query is intentionally unauthenticated — guests join
// without an account so there's no identity to verify against. The guestId
// (a Convex document ID, unguessable) acts as the sole credential, making it
// safe to return rtkAuthToken here. The guest needs the token exactly once
// (on transition to "admitted") to initialize the RTK client.
export const getGuestStatus = query({
  args: { guestId: v.id("studioGuests") },
  returns: v.union(
    v.object({
      _id: v.id("studioGuests"),
      _creationTime: v.number(),
      sessionId: v.id("studioSessions"),
      displayName: v.string(),
      rtkAuthToken: v.optional(v.string()),
      status: v.union(
        v.literal("waiting"),
        v.literal("admitted"),
        v.literal("rejected"),
        v.literal("removed"),
      ),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { guestId }) => {
    return ctx.db.get(guestId);
  },
});

export const rejectGuest = mutation({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const userId = await getAuthenticatedUser(ctx);

    const guest = await ctx.db.get(guestId);
    if (!guest) throw new Error("Guest not found");

    const session = await ctx.db.get(guest.sessionId);
    if (!session || session.creatorId !== userId)
      throw new Error("Not authorized");

    await ctx.db.patch(guestId, { status: "rejected" });
  },
});

// ─── Stage sync ──────────────────────────────────────────────────────────────

// Host writes the current canvas state so guests can mirror it in real time.
export const updateStage = mutation({
  args: { stageParticipantIds: v.array(v.string()), stageLayoutId: v.string() },
  handler: async (ctx, { stageParticipantIds, stageLayoutId }) => {
    const userId = await getAuthenticatedUser(ctx);
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first();
    if (!session) return; // session may have ended; silently ignore
    await ctx.db.patch(session._id, { stageParticipantIds, stageLayoutId });
  },
});

// Unauthenticated — guests need this to mirror the host's canvas without an account.
export const getSessionStage = query({
  args: { sessionId: v.id("studioSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.status !== "active") return null;
    return {
      stageParticipantIds: session.stageParticipantIds ?? [],
      stageLayoutId: session.stageLayoutId ?? null,
    };
  },
});

export const removeGuest = mutation({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const userId = await getAuthenticatedUser(ctx);

    const guest = await ctx.db.get(guestId);
    if (!guest) throw new Error("Guest not found");

    const session = await ctx.db.get(guest.sessionId);
    if (!session || session.creatorId !== userId)
      throw new Error("Not authorized");

    await ctx.db.patch(guestId, { status: "removed" });
  },
});

export const requestGuestJoin = mutation({
  args: { token: v.string(), displayName: v.string() },
  handler: async (ctx, { token, displayName }): Promise<Id<"studioGuests">> => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first();
    if (!session) throw new Error("Invalid invite token");
    if ((session.inviteTokenExpiresAt ?? 0) < Date.now())
      throw new Error("Invite token has expired");

    return ctx.db.insert("studioGuests", {
      sessionId: session._id,
      displayName: displayName.trim().slice(0, 40),
      status: "waiting",
      createdAt: Date.now(),
    });
  },
});

// ─── Internal helpers ────────────────────────────────────────────────────────

export const getGuestWithSession = internalQuery({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => {
    const guest = await ctx.db.get(guestId);
    if (!guest) return null;
    const session = await ctx.db.get(guest.sessionId);
    if (!session) return null;
    return { ...guest, session };
  },
});

export const admitGuestRecord = internalMutation({
  args: { guestId: v.id("studioGuests"), rtkAuthToken: v.string() },
  handler: async (ctx, { guestId, rtkAuthToken }): Promise<void> => {
    await ctx.db.patch(guestId, { status: "admitted", rtkAuthToken });
  },
});

// ─── Actions (call external Cloudflare Realtime API) ────────────────────────

export const createStudioSession = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    authToken: string;
    roomId: string;
    sessionId: Id<"studioSessions">;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!userRecord) throw new Error("Complete your profile first");
    const userId = userRecord._id;

    const { accountId, apiToken, appId } = getCloudflareRealtimeConfig();

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`;
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    // Create a meeting room
    const meetingRes = await fetch(`${baseUrl}/meetings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Switched Studio" }),
    });
    if (!meetingRes.ok) {
      const body = await meetingRes.text();
      throw new Error(
        `Failed to create meeting: ${meetingRes.status} — ${body}`,
      );
    }
    const meetingBody = (await meetingRes.json()) as { data: { id: string } };
    const meetingId = meetingBody.data.id;

    // Create a participant token for the creator.
    // CLOUDFLARE_REALTIMEKIT_HOST_PRESET_ID is the UUID of the host preset from
    // the Cloudflare RealtimeKit dashboard (Presets tab). If unset, the default
    // preset is used which may have restricted permissions.
    const participantRes = await fetch(
      `${baseUrl}/meetings/${meetingId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Creator",
          preset_name: "livestream_host",
          custom_participant_id: userId,
        }),
      },
    );
    if (!participantRes.ok) {
      const body = await participantRes.text();
      throw new Error(
        `Failed to create participant: ${participantRes.status} — ${body}`,
      );
    }
    const participantBody = (await participantRes.json()) as {
      data: { token: string };
    };
    const participant = participantBody.data;

    // Persist to DB via internalMutation
    const sessionId = await ctx.runMutation(
      internal.studio.storeStudioSession,
      {
        creatorId: userId as Id<"users">,
        cloudflareRoomId: meetingId,
        creatorAuthToken: participant.token,
      },
    );

    return { authToken: participant.token, roomId: meetingId, sessionId };
  },
});

export const endStudioSession = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!userRecord) throw new Error("Not authenticated");
    const userId = userRecord._id;

    await ctx.runMutation(internal.studio.endStudioSessionRecord, {
      creatorId: userId as Id<"users">,
    });
  },
});

export const admitGuest = action({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!userRecord) throw new Error("Not authenticated");
    const userId = userRecord._id;

    // Verify the caller owns the session this guest belongs to
    const guest = await ctx.runQuery(internal.studio.getGuestWithSession, {
      guestId,
    });
    if (!guest) throw new Error("Guest not found");
    if (guest.session.creatorId !== userId) throw new Error("Not authorized");

    const { accountId, apiToken, appId } = getCloudflareRealtimeConfig();

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`;
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    // CLOUDFLARE_REALTIMEKIT_GUEST_PRESET_ID is the UUID of the guest preset
    // from the Cloudflare RealtimeKit dashboard (Presets tab).

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
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Failed to create guest participant: ${res.status} — ${body}`,
      );
    }
    const { data } = (await res.json()) as { data: { token: string } };

    await ctx.runMutation(internal.studio.admitGuestRecord, {
      guestId,
      rtkAuthToken: data.token,
    });
  },
});
