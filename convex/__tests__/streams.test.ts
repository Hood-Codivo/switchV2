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
    title?: string
    category?: StreamCategory
    status?: "idle" | "starting" | "live" | "ended"
    viewerCount?: number
    playbackUrl?: string
  },
) {
  return ctx.db.insert("streams", {
    creatorId: overrides.creatorId as DataModel["streams"]["document"]["creatorId"],
    username: "testuser",
    title: overrides.title ?? "Test Stream",
    category: overrides.category ?? "Gaming",
    status: overrides.status ?? "live",
    viewerCount: overrides.viewerCount ?? 0,
    peakViewerCount: 0,
    playbackUrl: overrides.playbackUrl,
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
