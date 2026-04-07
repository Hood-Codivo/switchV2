import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedUser(ctx: GenericMutationCtx<DataModel>, username: string): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    privyDid: `did:privy:test-${username}`,
    walletAddress: `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV${username}`,
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    pointsBalance: 0,
    followerCount: 0,
    createdAt: Date.now(),
  })
}

async function seedSession(
  ctx: GenericMutationCtx<DataModel>,
  creatorId: string,
) {
  return ctx.db.insert("studioSessions", {
    creatorId: creatorId as DataModel["studioSessions"]["document"]["creatorId"],
    cloudflareRoomId: "cf-room-1",
    creatorAuthToken: "token-1",
    status: "active",
    createdAt: Date.now(),
  })
}

// ─── streams.create ──────────────────────────────────────────────────────────

describe("streams.create", () => {
  it("creates an idle stream record and derives username from the user profile", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, {
        title: "My First Stream",
        category: "Gaming",
      })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.status).toBe("idle")
    expect(stream?.title).toBe("My First Stream")
    expect(stream?.category).toBe("Gaming")
    expect(stream?.username).toBe("alice")
    expect(stream?.creatorId).toBe(userId)
    expect(stream?.viewerCount).toBe(0)
    expect(stream?.peakViewerCount).toBe(0)
  })

  it("throws if the user has not set a username yet", async () => {
    const t = convexTest(schema, modules)
    // Insert a user without a username (pre-onboarding state)
    await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "did:privy:test-newuser", walletAddress: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVNewUser" }),
    )

    await expect(
      t.withIdentity({ subject: "did:privy:test-newuser" }).mutation(api.streams.create, {
        title: "My Stream",
        category: "Gaming",
      }),
    ).rejects.toThrow()
  })

  it("throws when called unauthenticated", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.streams.create, {
        title: "My Stream",
        category: "Gaming",
      }),
    ).rejects.toThrow()
  })
})

// ─── streams.setLive ─────────────────────────────────────────────────────────

describe("streams.setLive", () => {
  it("transitions status to live and stores the playback URL", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Live Test", category: "Gaming" })

    await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.setLive, {
        id: streamId,
        playbackUrl: "https://customer-xyz.cloudflarestream.com/abc/manifest/video.m3u8",
      })


    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.status).toBe("live")
    expect(stream?.playbackUrl).toBe(
      "https://customer-xyz.cloudflarestream.com/abc/manifest/video.m3u8",
    )
    expect(stream?.startedAt).toBeGreaterThan(0)
  })

  it("throws when called by someone other than the stream owner", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bobId = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Alice's Stream", category: "Gaming" })

    await expect(
      t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.streams.setLive, {
        id: streamId,
        playbackUrl: "https://example.com/manifest.m3u8",
      }),
    ).rejects.toThrow()
  })

  it("throws when called unauthenticated", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Test", category: "Gaming" })

    await expect(
      t.mutation(api.streams.setLive, {
        id: streamId,
        playbackUrl: "https://example.com/manifest.m3u8",
      }),
    ).rejects.toThrow()
  })
})

// ─── streams.setStatus ───────────────────────────────────────────────────────

describe("streams.setStatus", () => {
  it("transitions to 'starting' status", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Test", category: "Gaming" })

    await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.setStatus, { id: streamId, status: "starting" })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.status).toBe("starting")
  })

  it("stores endedAt when transitioning to 'ended'", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Test", category: "Gaming" })

    const before = Date.now()
    await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.setStatus, {
        id: streamId,
        status: "ended",
        endedAt: Date.now(),
      })
    const after = Date.now()

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.status).toBe("ended")
    expect(stream?.endedAt).toBeGreaterThanOrEqual(before)
    expect(stream?.endedAt).toBeLessThanOrEqual(after)
  })

  it("throws when called by someone other than the stream owner", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bobId = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Alice's Stream", category: "Gaming" })

    await expect(
      t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.streams.setStatus, {
        id: streamId,
        status: "idle",
      }),
    ).rejects.toThrow()
  })

  it("throws when called unauthenticated", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Test", category: "Gaming" })

    await expect(
      t.mutation(api.streams.setStatus, { id: streamId, status: "idle" }),
    ).rejects.toThrow()
  })
})

// ─── streams.getByUsername ───────────────────────────────────────────────────

describe("streams.getByUsername", () => {
  it("returns the live stream for a given username", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Live Now", category: "Gaming" })
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.streams.setLive, {
      id: streamId,
      playbackUrl: "https://example.com/manifest.m3u8",
    })


    const result = await t.query(api.streams.getByUsername, { username: "alice" })

    expect(result?._id).toBe(streamId)
    expect(result?.status).toBe("live")
  })

  it("returns the starting stream while broadcast is initialising", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Starting Soon", category: "IRL" })
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.streams.setStatus, { id: streamId, status: "starting" })

    const result = await t.query(api.streams.getByUsername, { username: "alice" })

    expect(result?._id).toBe(streamId)
    expect(result?.status).toBe("starting")
  })

  it("returns null once the stream has ended", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Done", category: "Gaming" })
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.streams.setStatus, { id: streamId, status: "ended", endedAt: Date.now() })

    const result = await t.query(api.streams.getByUsername, { username: "alice" })

    expect(result).toBeNull()
  })

  it("returns null for an unknown username", async () => {
    const t = convexTest(schema, modules)

    const result = await t.query(api.streams.getByUsername, { username: "nobody" })

    expect(result).toBeNull()
  })
})

// ─── streams.getActive ───────────────────────────────────────────────────────

describe("streams.getActive", () => {
  it("returns the live stream for the authenticated user", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Active", category: "Music" })
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.streams.setLive, {
      id: streamId,
      playbackUrl: "https://example.com/manifest.m3u8",
    })


    const result = await t.query(api.streams.getActive, { userId: userId })

    expect(result?._id).toBe(streamId)
  })

  it("does not return an idle stream (pre-go-live)", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Idle", category: "Gaming" })

    const result = await t.query(api.streams.getActive, { userId: userId })

    expect(result).toBeNull()
  })

  it("does not return an ended stream", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.streams.create, { title: "Over", category: "Gaming" })
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.streams.setStatus, { id: streamId, status: "ended", endedAt: Date.now() })

    const result = await t.query(api.streams.getActive, { userId: userId })

    expect(result).toBeNull()
  })
})

// ─── streams.heartbeat ───────────────────────────────────────────────────────

describe("streams.heartbeat", () => {
  it("updates lastHeartbeatAt on the creator's active session", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))

    await t.withIdentity({ subject: "did:privy:test-alice" }).action(api.streams.heartbeat, {})

    const session = await t.run(async (ctx) => ctx.db.get(sessionId))
    expect(session?.lastHeartbeatAt).toBeGreaterThan(0)
  })

  it("is a no-op when the creator has no active session", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await expect(
      t.withIdentity({ subject: "did:privy:test-alice" }).action(api.streams.heartbeat, {}),
    ).resolves.not.toThrow()
  })
})
