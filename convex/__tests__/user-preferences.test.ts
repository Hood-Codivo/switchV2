import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api, internal } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedUser(
  ctx: GenericMutationCtx<DataModel>,
  username: string,
): Promise<Id<"users">> {
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

async function seedLiveStream(
  ctx: GenericMutationCtx<DataModel>,
  creatorId: Id<"users">,
  username: string,
): Promise<Id<"streams">> {
  return ctx.db.insert("streams", {
    creatorId,
    username,
    title: "Going Live!",
    category: "Gaming",
    status: "live",
    playbackUrl: "https://example.com/manifest.m3u8",
    startedAt: Date.now(),
    viewerCount: 0,
    peakViewerCount: 0,
  })
}

async function seedFollow(
  ctx: GenericMutationCtx<DataModel>,
  followerId: Id<"users">,
  creatorId: Id<"users">,
) {
  return ctx.db.insert("follows", { followerId, creatorId })
}

// ─── updateStreamPreferences ─────────────────────────────────────────────────

describe("users.updateStreamPreferences", () => {
  it("saves default category and slow mode interval", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "streamer"))

    await t
      .withIdentity({ subject: "did:privy:test-streamer" })
      .mutation(api.users.updateStreamPreferences, {
        defaultCategory: "Podcast",
        defaultSlowModeInterval: 5,
      })

    const user = await t.run(async (ctx) => ctx.db.get(userId))
    expect(user?.defaultCategory).toBe("Podcast")
    expect(user?.defaultSlowModeInterval).toBe(5)
  })

  it("rejects negative slow mode interval", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, "streamer"))

    await expect(
      t
        .withIdentity({ subject: "did:privy:test-streamer" })
        .mutation(api.users.updateStreamPreferences, {
          defaultCategory: "Gaming",
          defaultSlowModeInterval: -1,
        }),
    ).rejects.toThrow("Slow mode interval must be non-negative")
  })

  it("rejects unauthenticated users", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.users.updateStreamPreferences, {
        defaultCategory: "Gaming",
        defaultSlowModeInterval: 0,
      }),
    ).rejects.toThrow()
  })
})

// ─── updateNotificationPreferences ───────────────────────────────────────────

describe("users.updateNotificationPreferences", () => {
  it("saves notification preferences", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await t
      .withIdentity({ subject: "did:privy:test-viewer" })
      .mutation(api.users.updateNotificationPreferences, {
        notifyGoLive: false,
        notifyTips: true,
      })

    const user = await t.run(async (ctx) => ctx.db.get(userId))
    expect(user?.notifyGoLive).toBe(false)
    expect(user?.notifyTips).toBe(true)
  })

  it("rejects unauthenticated users", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.users.updateNotificationPreferences, {
        notifyGoLive: true,
        notifyTips: true,
      }),
    ).rejects.toThrow()
  })
})

// ─── Notification preference respected ───────────────────────────────────────

describe("fanOutGoLiveNotifications respects notifyGoLive", () => {
  it("skips notification when follower has notifyGoLive = false", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const f1 = await t.run(async (ctx) => seedUser(ctx, "follower1"))
    const f2 = await t.run(async (ctx) => seedUser(ctx, "follower2"))
    await t.run(async (ctx) => seedFollow(ctx, f1, creatorId))
    await t.run(async (ctx) => seedFollow(ctx, f2, creatorId))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    // follower1 opts out of go-live notifications
    await t
      .withIdentity({ subject: "did:privy:test-follower1" })
      .mutation(api.users.updateNotificationPreferences, {
        notifyGoLive: false,
        notifyTips: true,
      })

    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Going Live!",
    })

    const n1 = await t
      .withIdentity({ subject: "did:privy:test-follower1" })
      .query(api.notifications.list, {})
    const n2 = await t
      .withIdentity({ subject: "did:privy:test-follower2" })
      .query(api.notifications.list, {})

    expect(n1).toHaveLength(0) // opted out
    expect(n2).toHaveLength(1) // default: receives notification
  })

  it("sends notification when notifyGoLive is undefined (default)", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const followerId = await t.run(async (ctx) => seedUser(ctx, "follower"))
    await t.run(async (ctx) => seedFollow(ctx, followerId, creatorId))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Going Live!",
    })

    const notifs = await t
      .withIdentity({ subject: "did:privy:test-follower" })
      .query(api.notifications.list, {})

    expect(notifs).toHaveLength(1)
  })
})
