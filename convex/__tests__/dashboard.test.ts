import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"
import type { StreamCategory } from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ───────────────────────────────────────────────────────────────

async function seedUser(
  ctx: GenericMutationCtx<DataModel>,
  username: string,
  overrides?: { pointsBalance?: number; followerCount?: number },
) {
  return ctx.db.insert("users", {
    privyDid: `did:privy:test-${username}`,
    walletAddress: `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV${username}`,
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    pointsBalance: overrides?.pointsBalance ?? 0,
    followerCount: overrides?.followerCount ?? 0,
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
    tipTotal?: number
    startedAt?: number
    endedAt?: number
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
    tipTotal: overrides.tipTotal,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt,
  })
}

// ─── getDashboardOverview ──────────────────────────────────────────────────

describe("dashboard.getDashboardOverview", () => {
  it("returns zeroed overview for a new user with no activity", async () => {
    const t = convexTest(schema, modules)

    const userId = await t.run(async (ctx) => {
      return seedUser(ctx, "newuser")
    })

    const result = await t
      .withIdentity({ subject: "did:privy:test-newuser" })
      .query(api.dashboard.getDashboardOverview, {})

    expect(result).toEqual({
      isLive: false,
      recentStream: null,
      followerCount: 0,
      earningsSummary: { walletBalance: 0, recentTipCount: 0 },
      unreadNotificationCount: 0,
    })
  })

  it("returns the most recent ended stream as recentStream", async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      const userId = await seedUser(ctx, "streamer")
      await seedStream(ctx, {
        creatorId: userId,
        username: "streamer",
        title: "Old Stream",
        status: "ended",
        viewerCount: 50,
        peakViewerCount: 80,
        tipTotal: 10,
        startedAt: 1000,
        endedAt: 2000,
      })
      await seedStream(ctx, {
        creatorId: userId,
        username: "streamer",
        title: "Recent Stream",
        status: "ended",
        viewerCount: 200,
        peakViewerCount: 300,
        tipTotal: 50,
        startedAt: 5000,
        endedAt: 6000,
      })
    })

    const result = await t
      .withIdentity({ subject: "did:privy:test-streamer" })
      .query(api.dashboard.getDashboardOverview, {})

    expect(result!.recentStream).toEqual({
      title: "Recent Stream",
      viewerCount: 200,
      peakViewerCount: 300,
      tipTotal: 50,
      startedAt: 5000,
      endedAt: 6000,
    })
    expect(result!.isLive).toBe(false)
  })

  it("returns isLive true when user has a live stream", async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      const userId = await seedUser(ctx, "liveuser")
      await seedStream(ctx, {
        creatorId: userId,
        username: "liveuser",
        title: "Going Live!",
        status: "live",
      })
    })

    const result = await t
      .withIdentity({ subject: "did:privy:test-liveuser" })
      .query(api.dashboard.getDashboardOverview, {})

    expect(result!.isLive).toBe(true)
  })

  it("returns followerCount from the user record", async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      await seedUser(ctx, "popular", { followerCount: 42 })
    })

    const result = await t
      .withIdentity({ subject: "did:privy:test-popular" })
      .query(api.dashboard.getDashboardOverview, {})

    expect(result!.followerCount).toBe(42)
  })

  it("returns earnings summary with balance and received tip count", async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      const userId = await seedUser(ctx, "earner", { pointsBalance: 500 })
      const tipperId = await seedUser(ctx, "tipper")
      const streamId = await seedStream(ctx, {
        creatorId: userId,
        username: "earner",
        status: "ended",
      })

      // 3 tips received
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("tipTransactions", {
          fromUserId: tipperId,
          toUserId: userId,
          streamId,
          amount: 10,
          createdAt: Date.now(),
        })
      }

      // 1 tip sent (should not count)
      await ctx.db.insert("tipTransactions", {
        fromUserId: userId,
        toUserId: tipperId,
        streamId,
        amount: 5,
        createdAt: Date.now(),
      })
    })

    const result = await t
      .withIdentity({ subject: "did:privy:test-earner" })
      .query(api.dashboard.getDashboardOverview, {})

    expect(result!.earningsSummary.walletBalance).toBe(500)
    expect(result!.earningsSummary.recentTipCount).toBe(3)
  })
})
