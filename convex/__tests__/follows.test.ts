import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ───────────────────────────────────────────────────────────────

async function seedUser(
  ctx: GenericMutationCtx<DataModel>,
  overrides: { username: string; displayName?: string },
) {
  return ctx.db.insert("users", {
    privyDid: `did:privy:test-${overrides.username}`,
    walletAddress: `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV${overrides.username}`,
    username: overrides.username,
    displayName: overrides.displayName ?? overrides.username,
    bio: "",
    avatarUrl: null,
    pointsBalance: 0,
    followerCount: 0,
    createdAt: Date.now(),
  })
}

// ─── followUser ────────────────────────────────────────────────────────────

describe("follows.followUser", () => {
  it("throws when unauthenticated", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    await expect(
      t.mutation(api.follows.followUser, { creatorId: aliceId }),
    ).rejects.toThrow("Not authenticated")
  })

  it("throws when a user tries to follow themselves", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    await expect(
      t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.follows.followUser, { creatorId: aliceId }),
    ).rejects.toThrow("Cannot follow yourself")
  })

  it("is idempotent — following twice does not create a duplicate", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })
    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })

    const page = await t.query(api.follows.getChannelPage, { username: "alice" })
    expect(page?.followerCount).toBe(1)
  })
})

// ─── unfollowUser ──────────────────────────────────────────────────────────

describe("follows.unfollowUser", () => {
  it("removes the follow relationship and decreases the follower count", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })
    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.unfollowUser, { creatorId: aliceId })

    const page = await t.query(api.follows.getChannelPage, { username: "alice" })
    expect(page?.followerCount).toBe(0)
  })

  it("is a no-op when not following", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await expect(
      t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.unfollowUser, { creatorId: aliceId }),
    ).resolves.not.toThrow()
  })
})

// ─── getFollowState ────────────────────────────────────────────────────────

describe("follows.getFollowState", () => {
  it("returns false when the viewer is not following the creator", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    const state = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.follows.getFollowState, { creatorId: aliceId })
    expect(state).toBe(false)
  })

  it("returns true after following", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })

    const state = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.follows.getFollowState, { creatorId: aliceId })
    expect(state).toBe(true)
  })

  it("returns false after unfollowing", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })
    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.unfollowUser, { creatorId: aliceId })

    const state = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.follows.getFollowState, { creatorId: aliceId })
    expect(state).toBe(false)
  })

  it("returns false for unauthenticated viewers", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))

    const state = await t.query(api.follows.getFollowState, { creatorId: aliceId })
    expect(state).toBe(false)
  })
})

// ─── getChannelPage ────────────────────────────────────────────────────────

describe("follows.getChannelPage", () => {
  it("returns the creator profile and follower count for a known username", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, { username: "alice", displayName: "Alice" }))

    const page = await t.query(api.follows.getChannelPage, { username: "alice" })

    expect(page).not.toBeNull()
    expect(page?.user.username).toBe("alice")
    expect(page?.user.displayName).toBe("Alice")
    expect(page?.followerCount).toBe(0)
  })

  it("returns null for an unknown username", async () => {
    const t = convexTest(schema, modules)
    const page = await t.query(api.follows.getChannelPage, { username: "nobody" })
    expect(page).toBeNull()
  })

  it("follower count increases after a follow", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })

    const page = await t.query(api.follows.getChannelPage, { username: "alice" })
    expect(page?.followerCount).toBe(1)
  })
})

// ─── removeFollower ───────────────────────────────────────────────────────

describe("follows.removeFollower", () => {
  it("deletes the follow relationship and decrements the creator's follower count", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    // Bob follows Alice
    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })

    // Alice removes Bob as a follower
    await t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.follows.removeFollower, { followerId: bobId })

    const page = await t.query(api.follows.getChannelPage, { username: "alice" })
    expect(page?.followerCount).toBe(0)

    // Confirm the follow relationship no longer exists
    const state = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.follows.getFollowState, { creatorId: aliceId })
    expect(state).toBe(false)
  })

  it("is a no-op when the target is not a follower", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    const bobId = await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    // Alice tries to remove Bob who never followed her
    await expect(
      t.withIdentity({ subject: "did:privy:test-alice" }).mutation(api.follows.removeFollower, { followerId: bobId }),
    ).resolves.not.toThrow()

    const page = await t.query(api.follows.getChannelPage, { username: "alice" })
    expect(page?.followerCount).toBe(0)
  })
})

// ─── listFollowers ────────────────────────────────────────────────────────

describe("follows.listFollowers", () => {
  it("returns an empty list when the user has no followers", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))

    const followers = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.follows.listFollowers)
    expect(followers).toEqual([])
  })

  it("returns follower info after someone follows the user", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))
    await t.run(async (ctx) => seedUser(ctx, { username: "bob", displayName: "Bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })

    const followers = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.follows.listFollowers)
    expect(followers).toHaveLength(1)
    expect(followers[0].username).toBe("bob")
    expect(followers[0].displayName).toBe("Bob")
  })
})

// ─── listFollowing ────────────────────────────────────────────────────────

describe("follows.listFollowing", () => {
  it("returns an empty list when the user follows nobody", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, { username: "alice" }))

    const following = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.follows.listFollowing)
    expect(following).toEqual([])
  })

  it("returns followed creators after the user follows them", async () => {
    const t = convexTest(schema, modules)
    const aliceId = await t.run(async (ctx) => seedUser(ctx, { username: "alice", displayName: "Alice" }))
    await t.run(async (ctx) => seedUser(ctx, { username: "bob" }))

    await t.withIdentity({ subject: "did:privy:test-bob" }).mutation(api.follows.followUser, { creatorId: aliceId })

    const following = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.follows.listFollowing)
    expect(following).toHaveLength(1)
    expect(following[0].username).toBe("alice")
    expect(following[0].displayName).toBe("Alice")
  })
})
