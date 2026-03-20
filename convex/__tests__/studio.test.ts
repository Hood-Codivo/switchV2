import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
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
