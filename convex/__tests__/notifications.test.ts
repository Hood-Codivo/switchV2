import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api, internal } from "../_generated/api"
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

// ─── fanOutGoLiveNotifications ────────────────────────────────────────────────

describe("notifications.fanOutGoLiveNotifications", () => {
  it("creates a notification for each follower", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const f1 = await t.run(async (ctx) => seedUser(ctx, "follower1"))
    const f2 = await t.run(async (ctx) => seedUser(ctx, "follower2"))
    await t.run(async (ctx) => seedFollow(ctx, f1, creatorId))
    await t.run(async (ctx) => seedFollow(ctx, f2, creatorId))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Going Live!",
    })

    const n1 = await t.withIdentity({ subject: "did:privy:test-follower1" }).query(api.notifications.list, {})
    const n2 = await t.withIdentity({ subject: "did:privy:test-follower2" }).query(api.notifications.list, {})

    expect(n1).toHaveLength(1)
    expect(n1[0].type).toBe("go-live")
    expect(n1[0].streamTitle).toBe("Going Live!")
    expect(n1[0].read).toBe(false)
    expect(n2).toHaveLength(1)
  })

  it("does not create notifications for non-followers", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const nonFollower = await t.run(async (ctx) => seedUser(ctx, "stranger"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Going Live!",
    })

    const notifs = await t.withIdentity({ subject: "did:privy:test-stranger" }).query(api.notifications.list, {})
    expect(notifs).toHaveLength(0)
  })
})

// ─── getUnreadCount ───────────────────────────────────────────────────────────

describe("notifications.getUnreadCount", () => {
  it("returns the number of unread notifications", async () => {
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
      streamTitle: "Stream 1",
    })

    const count = await t.withIdentity({ subject: "did:privy:test-follower" }).query(api.notifications.getUnreadCount, {})
    expect(count).toBe(1)
  })

  it("returns 0 for unauthenticated users", async () => {
    const t = convexTest(schema, modules)
    const count = await t.query(api.notifications.getUnreadCount, {})
    expect(count).toBe(0)
  })
})

// ─── markRead / markAllRead ───────────────────────────────────────────────────

describe("notifications.markRead", () => {
  it("marks a single notification as read", async () => {
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
      streamTitle: "Test",
    })

    const notifs = await t.withIdentity({ subject: "did:privy:test-follower" }).query(api.notifications.list, {})
    await t.withIdentity({ subject: "did:privy:test-follower" }).mutation(api.notifications.markRead, {
      notificationId: notifs[0]._id,
    })

    const after = await t.withIdentity({ subject: "did:privy:test-follower" }).query(api.notifications.getUnreadCount, {})
    expect(after).toBe(0)
  })

  it("cannot mark another user's notification", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const followerId = await t.run(async (ctx) => seedUser(ctx, "follower"))
    const otherId = await t.run(async (ctx) => seedUser(ctx, "other"))
    await t.run(async (ctx) => seedFollow(ctx, followerId, creatorId))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Test",
    })

    const notifs = await t.withIdentity({ subject: "did:privy:test-follower" }).query(api.notifications.list, {})

    await expect(
      t.withIdentity({ subject: "did:privy:test-other" }).mutation(api.notifications.markRead, {
        notificationId: notifs[0]._id,
      }),
    ).rejects.toThrow()
  })
})

describe("notifications.markAllRead", () => {
  it("marks all notifications as read for the user", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const followerId = await t.run(async (ctx) => seedUser(ctx, "follower"))
    await t.run(async (ctx) => seedFollow(ctx, followerId, creatorId))
    const s1 = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    // Two go-live notifications
    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId: s1,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Stream 1",
    })
    await t.mutation(internal.notifications.fanOutGoLiveNotifications, {
      streamId: s1,
      creatorId,
      creatorName: "creator",
      creatorUsername: "creator",
      streamTitle: "Stream 2",
    })

    await t.withIdentity({ subject: "did:privy:test-follower" }).mutation(api.notifications.markAllRead, {})

    const count = await t.withIdentity({ subject: "did:privy:test-follower" }).query(api.notifications.getUnreadCount, {})
    expect(count).toBe(0)
  })
})

// ─── savePushSubscription ─────────────────────────────────────────────────────

describe("notifications.savePushSubscription", () => {
  it("saves a push subscription for the user", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "user"))

    await t.withIdentity({ subject: "did:privy:test-user" }).mutation(api.notifications.savePushSubscription, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dhKey: "key123",
      authKey: "auth123",
    })

    const subs = await t.run(async (ctx) =>
      ctx.db.query("pushSubscriptions").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    )
    expect(subs).toHaveLength(1)
    expect(subs[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123")
  })

  it("deduplicates by endpoint", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "user"))

    const args = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dhKey: "key1",
      authKey: "auth1",
    }

    await t.withIdentity({ subject: "did:privy:test-user" }).mutation(api.notifications.savePushSubscription, args)
    await t.withIdentity({ subject: "did:privy:test-user" }).mutation(api.notifications.savePushSubscription, {
      ...args,
      p256dhKey: "key2",
    })

    const subs = await t.run(async (ctx) =>
      ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint)).collect(),
    )
    expect(subs).toHaveLength(1)
    expect(subs[0].p256dhKey).toBe("key2")
  })

  it("rejects unauthenticated users", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.notifications.savePushSubscription, {
        endpoint: "https://example.com",
        p256dhKey: "key",
        authKey: "auth",
      }),
    ).rejects.toThrow()
  })
})
