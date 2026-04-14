import { convexTest } from "convex-test"
import { expect, it, describe, vi, afterEach } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"
import { encrypt } from "../lib/tokenEncryption"

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

// ─── streams.goLive simulcast ─────────────────────────────────────────────────

const TEST_ENCRYPTION_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"

async function seedUserWithSession(
  ctx: GenericMutationCtx<DataModel>,
  username: string,
) {
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
  const sessionId = await ctx.db.insert("studioSessions", {
    creatorId: userId,
    cloudflareRoomId: "cf-room-sim",
    creatorAuthToken: "creator-token",
    status: "active",
    createdAt: Date.now(),
    spendingLimitMinutes: 60,
    allowExtraUsageSpending: true,
    remainingApprovedMinutes: 60,
  })
  return { userId, sessionId }
}

async function seedYoutubeConnection(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
) {
  // Token is fresh for 1 hour — refreshYoutubeToken will skip the fetch call
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

function stubEnvsForGoLive() {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY)
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account")
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cf-token")
  vi.stubEnv("CLOUDFLARE_REALTIMEKIT_APP_ID", "test-app")
  vi.stubEnv("CLOUDFLARE_STREAM_API_TOKEN", "test-stream-token")
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client")
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-secret")
}

// Cloudflare Stream Live Input response (createLiveInput)
const MOCK_LIVE_INPUT_RESPONSE = {
  ok: true,
  status: 200,
  body: {
    result: {
      uid: "li-test",
      rtmps: { url: "rtmps://live.cloudflare.com:443/live/", streamKey: "cf-stream-key" },
    },
  },
}

// Cloudflare Stream Live Output response (createSimulcastOutput)
function mockLiveOutputResponse(uid: string) {
  return { ok: true, status: 200, body: { result: { uid } } }
}

/**
 * Build a fetch mock that returns sequential responses from the provided list.
 * Each call to fetch consumes the next response in the queue.
 */
function mockFetchSequence(
  responses: Array<{ ok: boolean; status: number; body: unknown }>,
) {
  let idx = 0
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const resp = responses[idx++] ?? { ok: false, status: 500, body: {} }
      return Promise.resolve({
        ok: resp.ok,
        status: resp.status,
        json: async () => resp.body,
        text: async () => JSON.stringify(resp.body),
      })
    }),
  )
}

describe("streams.goLive simulcast", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("happy path: creates streamBroadcast and transitions to live", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForGoLive()

    const { userId } = await t.run(async (ctx) => seedUserWithSession(ctx, "streamer"))
    await t.run(async (ctx) => seedYoutubeConnection(ctx, userId))

    // Fetch responses in order (v3 flow):
    // 1. RTK /livestreams POST (main HLS stream)
    // 2. Cloudflare Stream /live_inputs POST (ensureLiveInput — first-time creator)
    // 3. RTK /recordings POST (pointing at Live Input)
    // 4. YouTube liveBroadcasts.insert
    // 5. YouTube liveStreams.insert
    // 6. YouTube liveBroadcasts.bind
    // 7. Cloudflare Stream /live_inputs/:uid/outputs POST (YouTube Live Output)
    // 8. YouTube liveBroadcasts.transition → live
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: { data: { playback_url: "https://cf.example.com/manifest.m3u8" } },
      },
      MOCK_LIVE_INPUT_RESPONSE,
      {
        ok: true,
        status: 201,
        body: { data: { id: "rec-1" } },
      },
      {
        ok: true,
        status: 200,
        body: { id: "yt-b" },
      },
      {
        ok: true,
        status: 200,
        body: {
          id: "yt-s",
          cdn: { ingestionInfo: { ingestionAddress: "rtmp://a.rtmp.youtube.com/live2", streamName: "abc-key" } },
        },
      },
      {
        ok: true,
        status: 200,
        body: { id: "yt-b" },
      },
      mockLiveOutputResponse("lo-yt-1"),
      {
        ok: true,
        status: 200,
        body: { id: "yt-b", status: { lifeCycleStatus: "live" } },
      },
    ])

    const result = await t
      .withIdentity({ subject: "did:privy:test-streamer" })
      .action(api.streams.goLive, {
        title: "My Simulcast Stream",
        category: "Gaming",
        simulcast: {
          youtube: {
            title: "My YouTube Stream",
            description: "Streaming live!",
            privacy: "public",
          },
        },
      })

    expect(result.streamId).toBeTruthy()

    // Verify streamBroadcasts row
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", result.streamId as Id<"streams">))
        .collect(),
    )
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].status).toBe("live")
    expect(broadcasts[0].externalBroadcastId).toBe("yt-b")
    expect(broadcasts[0].rtkRecordingId).toBe("rec-1")
    expect(broadcasts[0].cloudflareLiveOutputUid).toBe("lo-yt-1")

    // Verify stream is live on Switched
    const stream = await t.run(async (ctx) => ctx.db.get(result.streamId as Id<"streams">))
    expect(stream?.status).toBe("live")
    expect(stream?.playbackUrl).toBeTruthy()
    expect(stream?.simulcastEnabled).toBe(true)
  })

  it("graceful-degrade: YouTube insert fails twice → broadcast=failed, stream stays live", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForGoLive()

    const { userId } = await t.run(async (ctx) => seedUserWithSession(ctx, "streamer2"))
    await t.run(async (ctx) => seedYoutubeConnection(ctx, userId))

    // Fetch responses (v3 flow):
    // 1. RTK /livestreams POST → success (HLS stream)
    // 2. Cloudflare Stream /live_inputs POST → success (ensureLiveInput)
    // 3. RTK /recordings POST → success
    // 4. YouTube liveBroadcasts.insert → 500 (first attempt)
    // 5. YouTube liveBroadcasts.insert → 500 (retry after 200ms)
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: { data: { playback_url: "https://cf.example.com/manifest2.m3u8" } },
      },
      MOCK_LIVE_INPUT_RESPONSE,
      {
        ok: true,
        status: 201,
        body: { data: { id: "rec-2" } },
      },
      {
        ok: false,
        status: 500,
        body: { error: { code: 500, message: "Internal Server Error" } },
      },
      {
        ok: false,
        status: 500,
        body: { error: { code: 500, message: "Internal Server Error" } },
      },
    ])

    const result = await t
      .withIdentity({ subject: "did:privy:test-streamer2" })
      .action(api.streams.goLive, {
        title: "Stream With YouTube Failure",
        category: "IRL",
        simulcast: {
          youtube: {
            title: "YouTube Title",
            description: "",
            privacy: "unlisted",
          },
        },
      })

    expect(result.streamId).toBeTruthy()

    // Broadcast row should be failed
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", result.streamId as Id<"streams">))
        .collect(),
    )
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].status).toBe("failed")

    // Switched stream should still be live with a playback URL
    const stream = await t.run(async (ctx) => ctx.db.get(result.streamId as Id<"streams">))
    expect(stream?.status).toBe("live")
    expect(stream?.playbackUrl).toBeTruthy()
  })

  it("no YouTube connection: broadcast=failed, stream goes live on Switched", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForGoLive()

    // Seed user with session but NO YouTube connection
    await t.run(async (ctx) => seedUserWithSession(ctx, "streamer3"))

    // Fetch responses (v3 flow):
    // 1. RTK /livestreams POST → success (HLS stream)
    // 2. Cloudflare Stream /live_inputs POST → success (ensureLiveInput)
    // 3. RTK /recordings POST → success
    // No YouTube calls — connection check throws before any YouTube fetch
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: { data: { playback_url: "https://cf.example.com/manifest3.m3u8" } },
      },
      MOCK_LIVE_INPUT_RESPONSE,
      {
        ok: true,
        status: 201,
        body: { data: { id: "rec-3" } },
      },
    ])

    const result = await t
      .withIdentity({ subject: "did:privy:test-streamer3" })
      .action(api.streams.goLive, {
        title: "Stream Without YouTube",
        category: "Tech",
        simulcast: {
          youtube: {
            title: "YouTube Title",
            description: "",
            privacy: "private",
          },
        },
      })

    expect(result.streamId).toBeTruthy()

    // Broadcast row should be failed with "not connected" message
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", result.streamId as Id<"streams">))
        .collect(),
    )
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].status).toBe("failed")
    expect(broadcasts[0].errorMessage).toContain("not connected")

    // Switched stream should be live
    const stream = await t.run(async (ctx) => ctx.db.get(result.streamId as Id<"streams">))
    expect(stream?.status).toBe("live")
  })

  it("goLive simulcasting to both YouTube + X creates two Live Outputs", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForGoLive()

    const { userId } = await t.run(async (ctx) => seedUserWithSession(ctx, "streamer4"))
    await t.run(async (ctx) => seedYoutubeConnection(ctx, userId))

    // Seed X connection with encrypted stream key
    await t.run(async (ctx) => {
      await ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "x",
        rtmpUrl: "rtmp://live.pscp.tv:80/x",
        streamKey: encrypt("x-stream-key-secret"),
        displayName: "X account",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    // Fetch responses (v3 flow):
    // 1. RTK /livestreams POST
    // 2. Cloudflare Stream /live_inputs POST (ensureLiveInput)
    // 3. RTK /recordings POST
    // 4. YouTube liveBroadcasts.insert
    // 5. YouTube liveStreams.insert
    // 6. YouTube liveBroadcasts.bind
    // 7. Cloudflare Stream /outputs POST (YouTube Live Output)
    // 8. YouTube liveBroadcasts.transition → live
    // 9. Cloudflare Stream /outputs POST (X Live Output)
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: { data: { playback_url: "https://cf.example.com/manifest4.m3u8" } },
      },
      MOCK_LIVE_INPUT_RESPONSE,
      {
        ok: true,
        status: 201,
        body: { data: { id: "rec-4" } },
      },
      {
        ok: true,
        status: 200,
        body: { id: "yt-b4" },
      },
      {
        ok: true,
        status: 200,
        body: {
          id: "yt-s4",
          cdn: { ingestionInfo: { ingestionAddress: "rtmp://a.rtmp.youtube.com/live2", streamName: "yt-key-4" } },
        },
      },
      {
        ok: true,
        status: 200,
        body: { id: "yt-b4" },
      },
      mockLiveOutputResponse("lo-yt-4"),
      {
        ok: true,
        status: 200,
        body: { id: "yt-b4", status: { lifeCycleStatus: "live" } },
      },
      mockLiveOutputResponse("lo-x-4"),
    ])

    const result = await t
      .withIdentity({ subject: "did:privy:test-streamer4" })
      .action(api.streams.goLive, {
        title: "Dual Simulcast Stream",
        category: "Gaming",
        simulcast: {
          youtube: {
            title: "YouTube Title",
            description: "Live on YouTube",
            privacy: "public",
          },
          x: true,
        },
      })

    expect(result.streamId).toBeTruthy()

    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", result.streamId as Id<"streams">))
        .collect(),
    )

    expect(broadcasts).toHaveLength(2)

    const ytBroadcast = broadcasts.find((b) => b.platform === "youtube")
    const xBroadcast = broadcasts.find((b) => b.platform === "x")

    expect(ytBroadcast?.status).toBe("live")
    expect(ytBroadcast?.cloudflareLiveOutputUid).toBe("lo-yt-4")
    expect(ytBroadcast?.externalBroadcastId).toBe("yt-b4")

    expect(xBroadcast?.status).toBe("live")
    expect(xBroadcast?.cloudflareLiveOutputUid).toBe("lo-x-4")

    const stream = await t.run(async (ctx) => ctx.db.get(result.streamId as Id<"streams">))
    expect(stream?.status).toBe("live")
    expect(stream?.simulcastEnabled).toBe(true)
  })

  it("goLive: YouTube fails, X succeeds → stream goes live with X only", async () => {
    const t = convexTest(schema, modules)
    stubEnvsForGoLive()

    const { userId } = await t.run(async (ctx) => seedUserWithSession(ctx, "streamer5"))
    await t.run(async (ctx) => seedYoutubeConnection(ctx, userId))

    // Seed X connection
    await t.run(async (ctx) => {
      await ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "x",
        rtmpUrl: "rtmp://live.pscp.tv:80/x",
        streamKey: encrypt("x-stream-key-5"),
        displayName: "X account",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    // Fetch responses (v3 flow):
    // 1. RTK /livestreams POST
    // 2. Cloudflare Stream /live_inputs POST (ensureLiveInput)
    // 3. RTK /recordings POST
    // 4. YouTube liveBroadcasts.insert → 500 (first attempt)
    // 5. YouTube liveBroadcasts.insert → 500 (retry) — YouTube path fails
    // 6. Cloudflare Stream /outputs POST (X Live Output succeeds)
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: { data: { playback_url: "https://cf.example.com/manifest5.m3u8" } },
      },
      MOCK_LIVE_INPUT_RESPONSE,
      {
        ok: true,
        status: 201,
        body: { data: { id: "rec-5" } },
      },
      {
        ok: false,
        status: 500,
        body: { error: { code: 500, message: "Internal Server Error" } },
      },
      {
        ok: false,
        status: 500,
        body: { error: { code: 500, message: "Internal Server Error" } },
      },
      mockLiveOutputResponse("lo-x-5"),
    ])

    const result = await t
      .withIdentity({ subject: "did:privy:test-streamer5" })
      .action(api.streams.goLive, {
        title: "YouTube Fail X Succeed",
        category: "Tech",
        simulcast: {
          youtube: {
            title: "YouTube Title",
            description: "",
            privacy: "public",
          },
          x: true,
        },
      })

    expect(result.streamId).toBeTruthy()

    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query("streamBroadcasts")
        .withIndex("by_stream", (q) => q.eq("streamId", result.streamId as Id<"streams">))
        .collect(),
    )

    expect(broadcasts).toHaveLength(2)

    const ytBroadcast = broadcasts.find((b) => b.platform === "youtube")
    const xBroadcast = broadcasts.find((b) => b.platform === "x")

    expect(ytBroadcast?.status).toBe("failed")
    expect(xBroadcast?.status).toBe("live")
    expect(xBroadcast?.cloudflareLiveOutputUid).toBe("lo-x-5")

    // Stream is still live on Switched
    const stream = await t.run(async (ctx) => ctx.db.get(result.streamId as Id<"streams">))
    expect(stream?.status).toBe("live")
  })
})
