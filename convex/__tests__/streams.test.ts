import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"
import type { StreamCategory } from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ───────────────────────────────────────────────────────────────

async function seedUser(ctx: GenericMutationCtx<DataModel>, username: string) {
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

async function seedStream(
  ctx: GenericMutationCtx<DataModel>,
  overrides: {
    creatorId: string
    username?: string
    title?: string
    category?: StreamCategory
    status?: "idle" | "starting" | "live" | "ended"
    viewerCount?: number
    peakViewerCount?: number
    playbackUrl?: string
    startedAt?: number
    endedAt?: number
    tipTotal?: number
  },
) {
  return ctx.db.insert("streams", {
    creatorId: overrides.creatorId as DataModel["streams"]["document"]["creatorId"],
    username: overrides.username ?? "testuser",
    title: overrides.title ?? "Test Stream",
    category: overrides.category ?? "Gaming",
    status: overrides.status ?? "live",
    viewerCount: overrides.viewerCount ?? 0,
    peakViewerCount: overrides.peakViewerCount ?? 0,
    playbackUrl: overrides.playbackUrl,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt,
    tipTotal: overrides.tipTotal,
  })
}

// ─── listLiveStreams ────────────────────────────────────────────────────────

describe("streams.listLiveStreams", () => {
  it("returns an empty array when no streams are live", async () => {
    const t = convexTest(schema, modules)
    const results = await t.query(api.streams.listLiveStreams, { category: null, searchQuery: "" })
    expect(results).toHaveLength(0)
  })

  it("returns only live streams, not offline ones", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      const bobId = await seedUser(ctx, "bob")
      await seedStream(ctx, { creatorId: aliceId, title: "Live Now", status: "live" })
      await seedStream(ctx, { creatorId: bobId, title: "Offline", status: "ended" })
    })

    const results = await t.query(api.streams.listLiveStreams, {
      category: null,
      searchQuery: "",
    })

    expect(results).toHaveLength(1)
    expect(results[0].stream.title).toBe("Live Now")
  })

  it("sorts live streams by viewerCount descending", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      const bobId = await seedUser(ctx, "bob")
      const carolId = await seedUser(ctx, "carol")
      await seedStream(ctx, { creatorId: aliceId, title: "Low", viewerCount: 10 })
      await seedStream(ctx, { creatorId: carolId, title: "High", viewerCount: 500 })
      await seedStream(ctx, { creatorId: bobId, title: "Mid", viewerCount: 100 })
    })

    const results = await t.query(api.streams.listLiveStreams, { category: null, searchQuery: "" })

    expect(results.map((r) => r.stream.title)).toEqual(["High", "Mid", "Low"])
  })

  it("filters by category, excluding other categories", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      const bobId = await seedUser(ctx, "bob")
      await seedStream(ctx, { creatorId: aliceId, title: "Gaming Stream", category: "Gaming" })
      await seedStream(ctx, { creatorId: bobId, title: "Podcast Show", category: "Podcast" })
    })

    const results = await t.query(api.streams.listLiveStreams, {
      category: "Gaming",
      searchQuery: "",
    })

    expect(results).toHaveLength(1)
    expect(results[0].stream.title).toBe("Gaming Stream")
  })

  it("returns all live streams when category is null", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      const bobId = await seedUser(ctx, "bob")
      await seedStream(ctx, { creatorId: aliceId, category: "Gaming" })
      await seedStream(ctx, { creatorId: bobId, category: "Podcast" })
    })

    const results = await t.query(api.streams.listLiveStreams, { category: null, searchQuery: "" })

    expect(results).toHaveLength(2)
  })

  it("prefix-matches on stream title", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      const bobId = await seedUser(ctx, "bob")
      await seedStream(ctx, { creatorId: aliceId, title: "Minecraft Mondays" })
      await seedStream(ctx, { creatorId: bobId, title: "Podcast Episode 1" })
    })

    const results = await t.query(api.streams.listLiveStreams, {
      category: null,
      searchQuery: "mine",
    })

    expect(results).toHaveLength(1)
    expect(results[0].stream.title).toBe("Minecraft Mondays")
  })

  it("prefix-matches on creator username", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice_plays")
      const bobId = await seedUser(ctx, "bobcasts")
      await seedStream(ctx, { creatorId: aliceId, title: "Stream A" })
      await seedStream(ctx, { creatorId: bobId, title: "Stream B" })
    })

    const results = await t.query(api.streams.listLiveStreams, {
      category: null,
      searchQuery: "alice",
    })

    expect(results).toHaveLength(1)
    expect(results[0].stream.title).toBe("Stream A")
  })

  it("returns empty array when search matches nothing", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      await seedStream(ctx, { creatorId: aliceId, title: "Gaming with Alice" })
    })

    const results = await t.query(api.streams.listLiveStreams, {
      category: null,
      searchQuery: "zzz",
    })

    expect(results).toHaveLength(0)
  })

  it("includes creator info on each result", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      await seedStream(ctx, { creatorId: aliceId, title: "Alice's Stream" })
    })

    const results = await t.query(api.streams.listLiveStreams, { category: null, searchQuery: "" })

    expect(results[0].creator?.username).toBe("alice")
  })
})

// ─── listPastStreams ──────────────────────────────────────────────────────────

describe("streams.listPastStreams", () => {
  it("returns ended streams for the authenticated user ordered most-recent first", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      await seedStream(ctx, {
        creatorId: aliceId,
        username: "alice",
        title: "Old Stream",
        status: "ended",
        startedAt: 1000,
        endedAt: 2000,
        tipTotal: 50,
        peakViewerCount: 10,
      })
      await seedStream(ctx, {
        creatorId: aliceId,
        username: "alice",
        title: "Recent Stream",
        status: "ended",
        startedAt: 5000,
        endedAt: 6000,
        tipTotal: 100,
        peakViewerCount: 25,
      })
      // Live stream should NOT appear
      await seedStream(ctx, {
        creatorId: aliceId,
        username: "alice",
        title: "Still Live",
        status: "live",
      })
    })

    const results = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.streams.listPastStreams, {})

    expect(results).toHaveLength(2)
    // Most recent first (desc order by _creationTime)
    expect(results[0].title).toBe("Recent Stream")
    expect(results[1].title).toBe("Old Stream")
    // Verify fields are returned
    expect(results[0].tipTotal).toBe(100)
    expect(results[0].peakViewerCount).toBe(25)
    expect(results[0].startedAt).toBe(5000)
    expect(results[0].endedAt).toBe(6000)
  })

  it("returns empty array for a user with no ended streams", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedUser(ctx, "bob")
    })

    const results = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.streams.listPastStreams, {})

    expect(results).toHaveLength(0)
  })

  it("does not return another user's streams", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      await seedUser(ctx, "bob")
      await seedStream(ctx, {
        creatorId: aliceId,
        username: "alice",
        title: "Alice Only",
        status: "ended",
        startedAt: 1000,
        endedAt: 2000,
      })
    })

    const results = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.streams.listPastStreams, {})

    expect(results).toHaveLength(0)
  })

  it("defaults tipTotal to 0 when not set", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const aliceId = await seedUser(ctx, "alice")
      await seedStream(ctx, {
        creatorId: aliceId,
        username: "alice",
        title: "No Tips",
        status: "ended",
      })
    })

    const results = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.streams.listPastStreams, {})

    expect(results[0].tipTotal).toBe(0)
  })
})
