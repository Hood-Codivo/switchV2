import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedUser(
  ctx: GenericMutationCtx<DataModel>,
  username: string,
  balance = 0,
): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    privyDid: `did:privy:test-${username}`,
    walletAddress: `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV${username}`,
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    pointsBalance: balance,
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
    title: "Test Stream",
    category: "Gaming",
    status: "live",
    playbackUrl: "https://example.com/manifest.m3u8",
    startedAt: Date.now(),
    viewerCount: 0,
    peakViewerCount: 0,
  })
}

// ─── sendTip ──────────────────────────────────────────────────────────────────

describe("tips.sendTip", () => {
  it("deducts from viewer balance, credits creator, logs transaction and alert", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer", 500))

    await t.withIdentity({ subject: "did:privy:test-viewer" }).mutation(api.tips.sendTip, {
      streamId,
      amount: 50,
      message: "Great stream!",
    })

    // Viewer balance deducted
    const viewer = await t.run(async (ctx) => ctx.db.get(viewerId))
    expect(viewer?.pointsBalance).toBe(450)

    // Creator balance credited
    const creator = await t.run(async (ctx) => ctx.db.get(creatorId))
    expect(creator?.pointsBalance).toBe(50)

    // Transaction logged
    const txs = await t.run(async (ctx) =>
      ctx.db.query("tipTransactions").withIndex("by_stream", (q) => q.eq("streamId", streamId)).collect(),
    )
    expect(txs).toHaveLength(1)
    expect(txs[0].amount).toBe(50)
    expect(txs[0].message).toBe("Great stream!")
    expect(txs[0].fromUserId).toBe(viewerId)
    expect(txs[0].toUserId).toBe(creatorId)

    // Alert created
    const alerts = await t.run(async (ctx) =>
      ctx.db.query("tipAlerts").withIndex("by_stream", (q) => q.eq("streamId", streamId)).collect(),
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].fromUsername).toBe("viewer")
    expect(alerts[0].amount).toBe(50)
  })

  it("rejects if viewer has insufficient balance", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer", 10))

    await expect(
      t.withIdentity({ subject: "did:privy:test-viewer" }).mutation(api.tips.sendTip, {
        streamId,
        amount: 50,
      }),
    ).rejects.toThrow("Insufficient")
  })

  it("rejects unauthenticated tips", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await expect(
      t.mutation(api.tips.sendTip, { streamId, amount: 10 }),
    ).rejects.toThrow("Not authenticated")
  })

  it("rejects tips on non-live streams", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const streamId = await t.run(async (ctx) =>
      ctx.db.insert("streams", {
        creatorId,
        username: "creator",
        title: "Ended",
        category: "Gaming",
        status: "ended",
        viewerCount: 0,
        peakViewerCount: 0,
      }),
    )
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer", 100))

    await expect(
      t.withIdentity({ subject: "did:privy:test-viewer" }).mutation(api.tips.sendTip, { streamId, amount: 10 }),
    ).rejects.toThrow("live")
  })

  it("rejects self-tipping", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 500))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await expect(
      t.withIdentity({ subject: "did:privy:test-creator" }).mutation(api.tips.sendTip, { streamId, amount: 10 }),
    ).rejects.toThrow("Cannot tip yourself")
  })

  it("rejects zero or negative amounts", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer", 100))

    await expect(
      t.withIdentity({ subject: "did:privy:test-viewer" }).mutation(api.tips.sendTip, { streamId, amount: 0 }),
    ).rejects.toThrow("Invalid")

    await expect(
      t.withIdentity({ subject: "did:privy:test-viewer" }).mutation(api.tips.sendTip, { streamId, amount: -5 }),
    ).rejects.toThrow("Invalid")
  })
})

// ─── getStreamTipTotal ────────────────────────────────────────────────────────

describe("tips.getStreamTipTotal", () => {
  it("returns the sum of all tips for a stream", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const v1 = await t.run(async (ctx) => seedUser(ctx, "v1", 500))
    const v2 = await t.run(async (ctx) => seedUser(ctx, "v2", 500))

    await t.withIdentity({ subject: "did:privy:test-v1" }).mutation(api.tips.sendTip, { streamId, amount: 20 })
    await t.withIdentity({ subject: "did:privy:test-v2" }).mutation(api.tips.sendTip, { streamId, amount: 30 })

    const total = await t.query(api.tips.getStreamTipTotal, { streamId })
    expect(total).toBe(50)
  })
})

// ─── listMyTipHistory ────────────────────────────────────────────────────────

describe("tips.listMyTipHistory", () => {
  it("returns sent and received tips with correct direction and counterparty", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice", 500))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob", 500))
    const streamByBob = await t.run(async (ctx) => seedLiveStream(ctx, bob, "bob"))
    const streamByAlice = await t.run(async (ctx) => seedLiveStream(ctx, alice, "alice"))

    // Alice tips Bob
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.tips.sendTip, {
      streamId: streamByBob,
      amount: 30,
      message: "Nice!",
    })

    // Bob tips Alice
    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.tips.sendTip, {
      streamId: streamByAlice,
      amount: 20,
      message: "Thanks!",
    })

    // Alice's history should show one sent and one received
    const aliceHistory = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.tips.listMyTipHistory, {})

    expect(aliceHistory).toHaveLength(2)

    const aliceSent = aliceHistory.find((tx) => tx.direction === "sent")
    const aliceReceived = aliceHistory.find((tx) => tx.direction === "received")

    expect(aliceSent).toBeDefined()
    expect(aliceSent!.counterpartyUsername).toBe("bob")
    expect(aliceSent!.amount).toBe(30)
    expect(aliceSent!.message).toBe("Nice!")

    expect(aliceReceived).toBeDefined()
    expect(aliceReceived!.counterpartyUsername).toBe("bob")
    expect(aliceReceived!.amount).toBe(20)
  })

  it("returns empty array when user has no transactions", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, "lonely", 100))

    const history = await t
      .withIdentity({ subject: "did:privy:test-lonely" })
      .query(api.tips.listMyTipHistory, {})

    expect(history).toHaveLength(0)
  })

  it("sorts results by createdAt descending (most recent first)", async () => {
    const t = convexTest(schema, modules)
    const creator = await t.run(async (ctx) => seedUser(ctx, "creator", 0))
    const stream = await t.run(async (ctx) => seedLiveStream(ctx, creator, "creator"))
    await t.run(async (ctx) => seedUser(ctx, "tipper", 1000))

    await t.withIdentity({ subject: "did:privy:test-tipper" }).mutation(api.tips.sendTip, {
      streamId: stream,
      amount: 10,
    })
    await t.withIdentity({ subject: "did:privy:test-tipper" }).mutation(api.tips.sendTip, {
      streamId: stream,
      amount: 20,
    })

    const history = await t
      .withIdentity({ subject: "did:privy:test-tipper" })
      .query(api.tips.listMyTipHistory, {})

    expect(history).toHaveLength(2)
    expect(history[0].createdAt).toBeGreaterThanOrEqual(history[1].createdAt)
  })
})

// ─── withdraw ────────────────────────────────────────────────────────────────

describe("tips.withdraw", () => {
  it("deducts the requested amount from user balance", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "withdrawer", 500))

    const result = await t
      .withIdentity({ subject: "did:privy:test-withdrawer" })
      .mutation(api.tips.withdraw, { amount: 200 })

    expect(result.success).toBe(true)
    expect(result.newBalance).toBe(300)

    const user = await t.run(async (ctx) => ctx.db.get(userId))
    expect(user?.pointsBalance).toBe(300)
  })

  it("rejects withdrawal with insufficient balance", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, "broke", 50))

    await expect(
      t.withIdentity({ subject: "did:privy:test-broke" }).mutation(api.tips.withdraw, { amount: 100 }),
    ).rejects.toThrow("Insufficient")
  })

  it("rejects zero or negative withdrawal amounts", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, "badactor", 500))

    await expect(
      t.withIdentity({ subject: "did:privy:test-badactor" }).mutation(api.tips.withdraw, { amount: 0 }),
    ).rejects.toThrow("Invalid")

    await expect(
      t.withIdentity({ subject: "did:privy:test-badactor" }).mutation(api.tips.withdraw, { amount: -10 }),
    ).rejects.toThrow("Invalid")
  })

  it("rejects unauthenticated withdrawals", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.tips.withdraw, { amount: 10 }),
    ).rejects.toThrow("Not authenticated")
  })
})

// ─── getBalance ───────────────────────────────────────────────────────────────

describe("tips.getBalance", () => {
  it("returns the viewer's current balance", async () => {
    const t = convexTest(schema, modules)
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer", 400))

    const balance = await t.withIdentity({ subject: "did:privy:test-viewer" }).query(api.tips.getBalance, {})
    expect(balance).toBe(400)
  })

  it("returns null for unauthenticated users", async () => {
    const t = convexTest(schema, modules)
    const balance = await t.query(api.tips.getBalance, {})
    expect(balance).toBeNull()
  })
})
