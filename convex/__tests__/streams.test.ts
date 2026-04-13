import { convexTest } from "convex-test"
import { expect, it, describe, vi, afterEach } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"
import type { StreamCategory } from "../schema"
import { encrypt } from "../lib/tokenEncryption"

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

// ─── streams.endLivestream (simulcast tear-down) ──────────────────────────────

const TEST_ENCRYPTION_KEY_END = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"

function stubEnvsForEnd() {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY_END)
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account")
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cf-token")
  vi.stubEnv("CLOUDFLARE_REALTIMEKIT_APP_ID", "test-app")
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client")
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-secret")
}

function mockFetchSequenceEnd(
  responses: Array<{ ok: boolean; status: number; body: unknown }>,
) {
  let idx = 0
  const calls: string[] = []
  const mockFn = vi.fn().mockImplementation((url: string) => {
    calls.push(url as string)
    const resp = responses[idx++] ?? { ok: false, status: 500, body: {} }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    })
  })
  vi.stubGlobal("fetch", mockFn)
  return { calls, mockFn }
}

async function seedUserWithLiveStream(ctx: GenericMutationCtx<DataModel>, username: string) {
  const userId = await ctx.db.insert("users", {
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
  const streamId = await ctx.db.insert("streams", {
    creatorId: userId,
    username,
    title: "Live Stream",
    category: "Gaming",
    status: "live",
    viewerCount: 0,
    peakViewerCount: 0,
    playbackUrl: "https://cf.example.com/manifest.m3u8",
    startedAt: Date.now(),
    simulcastEnabled: true,
  })
  const sessionId = await ctx.db.insert("studioSessions", {
    creatorId: userId,
    cloudflareRoomId: "cf-room-end",
    creatorAuthToken: "creator-token",
    status: "active",
    createdAt: Date.now(),
    streamId,
    spendingLimitMinutes: 60,
    allowExtraUsageSpending: true,
    remainingApprovedMinutes: 60,
  })
  return { userId, streamId, sessionId }
}

async function seedYoutubeConnectionForEnd(ctx: GenericMutationCtx<DataModel>, userId: Id<"users">) {
  const accessToken = encrypt("ya29.test-access-token")
  const refreshToken = encrypt("1//test-refresh-token")
  return ctx.db.insert("connectedPlatforms", {
    userId,
    platform: "youtube",
    accessToken,
    refreshToken,
    tokenExpiresAt: Date.now() + 3_600_000,
    channelId: "UC-test",
    channelTitle: "Test Channel",
    displayName: "Test Channel",
    connectedAt: Date.now(),
    status: "active",
  })
}

describe("streams.endLivestream simulcast tear-down", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("transitions YouTube broadcast to complete and stops RealtimeKit recording", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForEnd()

    const { userId, streamId } = await t.run(async (ctx) =>
      seedUserWithLiveStream(ctx, "ender1"),
    )
    await t.run(async (ctx) => seedYoutubeConnectionForEnd(ctx, userId))

    // Seed a live streamBroadcast
    await t.run(async (ctx) => {
      await ctx.db.insert("streamBroadcasts", {
        streamId: streamId as Id<"streams">,
        platform: "youtube",
        status: "live",
        externalBroadcastId: "yt-b-end",
        externalStreamId: "yt-s-end",
        rtkRecordingId: "rec-end-1",
        createdAt: Date.now(),
      })
    })

    // Fetch sequence for endLivestream with a live YouTube broadcast:
    // 1. refreshYoutubeToken (no-op since not expired — but it may call token endpoint)
    //    Actually the token is fresh, so refreshYoutubeToken won't fetch — skip
    // 1. YouTube transitionBroadcast → complete (POST)
    // 2. RealtimeKit stopRecording (PUT /recordings/:id)
    // 3. RealtimeKit active-livestream/stop (POST)
    const { calls } = mockFetchSequenceEnd([
      { ok: true, status: 200, body: { id: "yt-b-end", status: { lifeCycleStatus: "complete" } } }, // YouTube transition
      { ok: true, status: 200, body: {} }, // RTK stopRecording
      { ok: true, status: 200, body: {} }, // RTK livestream stop
    ])

    await t
      .withIdentity({ subject: "did:privy:test-ender1" })
      .action(api.streams.endLivestream, { streamId: streamId as Id<"streams"> })

    // Broadcast should be ended
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", streamId as Id<"streams">))
        .collect(),
    )
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].status).toBe("ended")

    // Stream should be ended
    const stream = await t.run(async (ctx) => ctx.db.get(streamId as Id<"streams">))
    expect(stream?.status).toBe("ended")

    // YouTube transition URL should contain broadcastStatus=complete
    const ytTransitionCall = calls.find((url) => url.includes("broadcastStatus=complete"))
    expect(ytTransitionCall).toBeTruthy()
  })

  it("YouTube 500 does not block local cleanup — broadcast still ends", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForEnd()

    const { userId, streamId } = await t.run(async (ctx) =>
      seedUserWithLiveStream(ctx, "ender2"),
    )
    await t.run(async (ctx) => seedYoutubeConnectionForEnd(ctx, userId))

    // Seed a live streamBroadcast
    await t.run(async (ctx) => {
      await ctx.db.insert("streamBroadcasts", {
        streamId: streamId as Id<"streams">,
        platform: "youtube",
        status: "live",
        externalBroadcastId: "yt-b-fail",
        externalStreamId: "yt-s-fail",
        rtkRecordingId: "rec-fail-1",
        createdAt: Date.now(),
      })
    })

    // YouTube transition returns 500 (best-effort — should not throw)
    // Then RTK stopRecording and RTK livestream stop succeed
    mockFetchSequenceEnd([
      { ok: false, status: 500, body: { error: { code: 500, message: "Internal Server Error" } } }, // YouTube transition FAILS
      { ok: true, status: 200, body: {} }, // RTK stopRecording
      { ok: true, status: 200, body: {} }, // RTK livestream stop
    ])

    await t
      .withIdentity({ subject: "did:privy:test-ender2" })
      .action(api.streams.endLivestream, { streamId: streamId as Id<"streams"> })

    // Broadcast should still be ended despite YouTube failure
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", streamId as Id<"streams">))
        .collect(),
    )
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].status).toBe("ended")

    // Stream should still be ended
    const stream = await t.run(async (ctx) => ctx.db.get(streamId as Id<"streams">))
    expect(stream?.status).toBe("ended")
  })
})
