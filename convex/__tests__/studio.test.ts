import { convexTest } from "convex-test"
import { expect, it, describe, vi, afterEach } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { api, internal } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ───────────────────────────────────────────────────────────────

async function seedUser(ctx: GenericMutationCtx<DataModel>, username: string) {
  return ctx.db.insert("users", {
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    pointsBalance: 0,
    createdAt: Date.now(),
  })
}

async function seedStudioSession(
  ctx: GenericMutationCtx<DataModel>,
  overrides: {
    creatorId: string
    cloudflareRoomId?: string
    creatorAuthToken?: string
    status?: "active" | "ended"
  },
) {
  return ctx.db.insert("studioSessions", {
    creatorId: overrides.creatorId as DataModel["studioSessions"]["document"]["creatorId"],
    cloudflareRoomId: overrides.cloudflareRoomId ?? "cf-room-123",
    creatorAuthToken: overrides.creatorAuthToken ?? "auth-token-xyz",
    status: overrides.status ?? "active",
    createdAt: Date.now(),
  })
}

// ─── getActiveSession ───────────────────────────────────────────────────────

describe("getActiveSession", () => {
  it("returns null when no session exists", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    const result = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})

    expect(result).toBeNull()
  })

  it("returns the active session for the authenticated creator", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await t.run(async (ctx) =>
      seedStudioSession(ctx, {
        creatorId: userId,
        cloudflareRoomId: "cf-room-abc",
        creatorAuthToken: "token-abc",
      }),
    )

    const result = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})

    expect(result).not.toBeNull()
    expect(result?.cloudflareRoomId).toBe("cf-room-abc")
    expect(result?.creatorAuthToken).toBe("token-abc")
    expect(result?.status).toBe("active")
  })

  it("returns null when only an ended session exists", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await t.run(async (ctx) =>
      seedStudioSession(ctx, { creatorId: userId, status: "ended" }),
    )

    const result = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})

    expect(result).toBeNull()
  })

  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules)

    const result = await t.query(api.studio.getActiveSession, {})

    expect(result).toBeNull()
  })

  it("only returns session belonging to authenticated creator, not another user's session", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))

    await t.run(async (ctx) => seedStudioSession(ctx, { creatorId: bob }))

    const result = await t.withIdentity({ subject: alice }).query(api.studio.getActiveSession, {})

    expect(result).toBeNull()
  })
})

// ─── storeStudioSession (internalMutation) ──────────────────────────────────

describe("storeStudioSession", () => {
  it("stores a new active session and returns its id", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-new",
      creatorAuthToken: "token-new",
    })

    expect(sessionId).toBeDefined()

    // Verify the session is now retrievable
    const result = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})
    expect(result?.cloudflareRoomId).toBe("cf-room-new")
  })

  it("ends any existing active session before storing a new one", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    // Store first session
    await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-old",
      creatorAuthToken: "token-old",
    })

    // Store second session
    await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-new",
      creatorAuthToken: "token-new",
    })

    // Only the new session should be active
    const result = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})
    expect(result?.cloudflareRoomId).toBe("cf-room-new")
  })
})

// ─── endStudioSessionRecord (internalMutation) ──────────────────────────────

describe("endStudioSessionRecord", () => {
  it("marks the active session as ended", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    await t.mutation(internal.studio.endStudioSessionRecord, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
    })

    const result = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})
    expect(result).toBeNull()
  })

  it("deletes all backstage messages for the session", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    const sessionId = await t.run(async (ctx) =>
      ctx.db.insert("studioSessions", {
        creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
        cloudflareRoomId: "cf-room-1",
        creatorAuthToken: "token-1",
        status: "active",
        createdAt: Date.now(),
      }),
    )

    await t.run(async (ctx) => {
      await ctx.db.insert("backstageMessages", {
        sessionId,
        senderType: "creator",
        senderId: userId,
        senderName: "alice",
        content: "hello",
        createdAt: Date.now(),
      })
    })

    await t.mutation(internal.studio.endStudioSessionRecord, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
    })

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("backstageMessages")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect(),
    )
    expect(remaining).toHaveLength(0)
  })

  it("is a no-op when there is no active session", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    // Should not throw
    await expect(
      t.mutation(internal.studio.endStudioSessionRecord, {
        creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      }),
    ).resolves.not.toThrow()
  })
})

describe("generateInviteToken", () => {
  it("stores an invite token on the active session and returns the token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    const token = await t.withIdentity({ subject: userId }).mutation(api.studio.generateInviteToken, {})

    expect(typeof token).toBe("string")
    expect(token.length).toBeGreaterThan(0)

    const session = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})
    expect(session?.inviteToken).toBe(token)
    expect(session?.inviteTokenExpiresAt).toBeGreaterThan(Date.now())
  })

  it("respects a custom expiresInHours argument", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    const before = Date.now()
    await t.withIdentity({ subject: userId }).mutation(api.studio.generateInviteToken, { expiresInHours: 1 })
    const session = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})

    const oneHourMs = 60 * 60 * 1000
    expect(session?.inviteTokenExpiresAt).toBeGreaterThanOrEqual(before + oneHourMs)
    expect(session?.inviteTokenExpiresAt).toBeLessThan(before + oneHourMs + 5_000)
  })

  it("throws if there is no active session", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await expect(
      t.withIdentity({ subject: userId }).mutation(api.studio.generateInviteToken, {}),
    ).rejects.toThrow("No active studio session")
  })

  it("throws if unauthenticated", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.studio.generateInviteToken, {}),
    ).rejects.toThrow()
  })
})

describe("getSessionByInviteToken", () => {
  it("returns session info for a valid, unexpired token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })

    const result = await t.query(api.studio.getSessionByInviteToken, { token: "valid-token" })
    expect(result?.sessionId).toBe(sessionId)
    expect(result?.expired).toBe(false)
  })

  it("returns expired:true for an expired token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "expired-token",
        inviteTokenExpiresAt: Date.now() - 1,
      })
    })

    const result = await t.query(api.studio.getSessionByInviteToken, { token: "expired-token" })
    expect(result?.expired).toBe(true)
  })

  it("returns null for an unknown token", async () => {
    const t = convexTest(schema, modules)
    const result = await t.query(api.studio.getSessionByInviteToken, { token: "unknown" })
    expect(result).toBeNull()
  })
})

describe("listSessionGuests", () => {
  it("returns guests for the session in creation order", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })

    await t.mutation(api.studio.requestGuestJoin, { token: "valid-token", displayName: "Bob" })
    await t.mutation(api.studio.requestGuestJoin, { token: "valid-token", displayName: "Carol" })

    const guests = await t.withIdentity({ subject: userId }).query(api.studio.listSessionGuests, {
      sessionId,
    })

    expect(guests).toHaveLength(2)
    expect(guests[0].displayName).toBe("Bob")
    expect(guests[1].displayName).toBe("Carol")
  })

  it("returns empty array when no guests have joined", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    const guests = await t.withIdentity({ subject: userId }).query(api.studio.listSessionGuests, {
      sessionId,
    })

    expect(guests).toHaveLength(0)
  })

  it("returns empty array when called unauthenticated", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    const guests = await t.query(api.studio.listSessionGuests, { sessionId })
    expect(guests).toEqual([])
  })

  it("returns empty array when caller is not the session creator", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: alice as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    const guests = await t.withIdentity({ subject: bob }).query(api.studio.listSessionGuests, { sessionId })
    expect(guests).toEqual([])
  })
})

describe("getGuestStatus", () => {
  it("returns the current status of a guest", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, {
      token: "valid-token",
      displayName: "Bob",
    })

    const result = await t.query(api.studio.getGuestStatus, { guestId })

    expect(result?.status).toBe("waiting")
    expect(result?.displayName).toBe("Bob")
    expect(result?.rtkAuthToken).toBeUndefined()
  })

  it("returns null for a deleted guestId", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, {
      token: "valid-token",
      displayName: "Bob",
    })
    // Delete the guest so the ID no longer resolves
    await t.run(async (ctx) => ctx.db.delete(guestId))

    const result = await t.query(api.studio.getGuestStatus, { guestId })
    expect(result).toBeNull()
  })
})

describe("rejectGuest", () => {
  it("sets guest status to rejected", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { inviteToken: "valid-token", inviteTokenExpiresAt: Date.now() + 60_000 })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "valid-token", displayName: "Bob" })

    await t.withIdentity({ subject: userId }).mutation(api.studio.rejectGuest, { guestId })

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("rejected")
  })

  it("throws when caller is not the session creator", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: alice as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { inviteToken: "tok", inviteTokenExpiresAt: Date.now() + 60_000 })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "tok", displayName: "Eve" })

    await expect(
      t.withIdentity({ subject: bob }).mutation(api.studio.rejectGuest, { guestId }),
    ).rejects.toThrow()
  })
})

describe("removeGuest", () => {
  it("sets an admitted guest's status to removed", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { inviteToken: "valid-token", inviteTokenExpiresAt: Date.now() + 60_000 })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "valid-token", displayName: "Bob" })
    // Manually admit the guest (bypass the action)
    await t.run(async (ctx) => ctx.db.patch(guestId, { status: "admitted", rtkAuthToken: "guest-rtk-token" }))

    await t.withIdentity({ subject: userId }).mutation(api.studio.removeGuest, { guestId })

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("removed")
  })

  it("throws when caller is not the session creator", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: alice as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { inviteToken: "tok", inviteTokenExpiresAt: Date.now() + 60_000 })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "tok", displayName: "Eve" })

    await expect(
      t.withIdentity({ subject: bob }).mutation(api.studio.removeGuest, { guestId }),
    ).rejects.toThrow()
  })
})

describe("admitGuest", () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockFetch(guestToken: string) {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account")
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token")
    vi.stubEnv("CLOUDFLARE_REALTIMEKIT_APP_ID", "test-app")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { token: guestToken } }),
      }),
    )
  }

  it("sets guest status to admitted and stores the RTK auth token", async () => {
    const t = convexTest(schema, modules)
    mockFetch("guest-rtk-token-abc")

    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { inviteToken: "valid-token", inviteTokenExpiresAt: Date.now() + 60_000 })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "valid-token", displayName: "Bob" })

    await t.withIdentity({ subject: userId }).action(api.studio.admitGuest, { guestId })

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("admitted")
    expect(guest?.rtkAuthToken).toBe("guest-rtk-token-abc")

    // Verify the correct RTK API URL and auth header were used
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/realtime/kit/test-app/meetings/cf-room-1/participants",
    )
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-token")
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.custom_participant_id).toBe(guestId)
    expect(body.preset_name).toBe("livestream_guest")
  })

  it("throws when caller is not the session creator", async () => {
    const t = convexTest(schema, modules)
    mockFetch("guest-rtk-token")

    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: alice as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { inviteToken: "tok", inviteTokenExpiresAt: Date.now() + 60_000 })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "tok", displayName: "Eve" })

    await expect(
      t.withIdentity({ subject: bob }).action(api.studio.admitGuest, { guestId }),
    ).rejects.toThrow()
  })
})

describe("requestGuestJoin", () => {
  it("creates a waiting guest record and returns its id", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })

    const guestId = await t.mutation(api.studio.requestGuestJoin, {
      token: "valid-token",
      displayName: "Bob",
    })

    expect(guestId).toBeDefined()

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("waiting")
    expect(guest?.displayName).toBe("Bob")
  })

  it("throws for an expired token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "expired-token",
        inviteTokenExpiresAt: Date.now() - 1,
      })
    })

    await expect(
      t.mutation(api.studio.requestGuestJoin, { token: "expired-token", displayName: "Bob" }),
    ).rejects.toThrow("expired")
  })
})
