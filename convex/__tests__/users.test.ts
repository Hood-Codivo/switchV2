import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// Valid Solana base58 test addresses (44 chars each)
const WALLET_ALICE = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVa"
const WALLET_BOB = "8FdEiTZGyYztdtaZFq46LJN9wwx4twBvMKUaYwDGMuWb"

// Pre-onboarding user: has privyDid and walletAddress but no username
const preOnboardingUser = {
  privyDid: "did:privy:test-alice",
  walletAddress: WALLET_ALICE,
}

// Fully onboarded user record
const onboardedUser = {
  privyDid: "did:privy:test-alice",
  walletAddress: WALLET_ALICE,
  username: "alice",
  displayName: "Alice",
  bio: "",
  avatarUrl: null as null,
  pointsBalance: 0,
  followerCount: 0,
  createdAt: Date.now(),
}

// ─── getCurrentUser ────────────────────────────────────────────────────────

describe("users.getCurrentUser", () => {
  it("returns null when the authenticated user has not completed onboarding", async () => {
    const t = convexTest(schema, modules)
    // Simulate a user who authenticated via Privy but hasn't set a username yet
    await t.run(async (ctx) =>
      ctx.db.insert("users", preOnboardingUser),
    )
    const user = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.users.getCurrentUser, {})
    expect(user).toBeNull()
  })

  it("returns the user record for a fully onboarded user", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) =>
      ctx.db.insert("users", onboardedUser),
    )
    const user = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.users.getCurrentUser, {})
    expect(user?.username).toBe("alice")
  })

  it("returns null when called unauthenticated", async () => {
    const t = convexTest(schema, modules)
    const user = await t.query(api.users.getCurrentUser, {})
    expect(user).toBeNull()
  })
})

// ─── checkUsernameAvailable ────────────────────────────────────────────────

describe("users.checkUsernameAvailable", () => {
  it("returns true when username is not taken", async () => {
    const t = convexTest(schema, modules)
    const available = await t.query(api.users.checkUsernameAvailable, {
      username: "alice",
    })
    expect(available).toBe(true)
  })

  it("returns false when username is already taken", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => ctx.db.insert("users", onboardedUser))
    const available = await t.query(api.users.checkUsernameAvailable, {
      username: "alice",
    })
    expect(available).toBe(false)
  })
})

// ─── completeOnboarding ────────────────────────────────────────────────────

describe("users.completeOnboarding", () => {
  it("creates a new user record with profile data", async () => {
    const t = convexTest(schema, modules)
    // In the Privy flow, completeOnboarding creates the user record (no pre-existing record)
    await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.users.completeOnboarding, {
        username: "alice",
        displayName: "Alice",
        walletAddress: WALLET_ALICE,
      })
    const user = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.users.getCurrentUser, {})
    expect(user?.username).toBe("alice")
    expect(user?.displayName).toBe("Alice")
    expect(user?.bio).toBe("")
    expect(user?.avatarUrl).toBeNull()
    expect(user?.pointsBalance).toBe(0)
    expect(user?.createdAt).toBeTypeOf("number")
  })

  it("throws when called unauthenticated", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(api.users.completeOnboarding, {
        username: "alice",
        displayName: "Alice",
        walletAddress: WALLET_ALICE,
      }),
    ).rejects.toThrow("Not authenticated")
  })

  it("throws if username is already taken", async () => {
    const t = convexTest(schema, modules)
    // Alice already claimed the username
    await t.run(async (ctx) => ctx.db.insert("users", onboardedUser))
    // Bob tries to claim the same username
    await expect(
      t
        .withIdentity({ subject: "did:privy:test-bob" })
        .mutation(api.users.completeOnboarding, {
          username: "alice",
          displayName: "Bob",
          walletAddress: WALLET_BOB,
        }),
    ).rejects.toThrow("Username is already taken")
  })

  it("throws if username fails format validation", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t
        .withIdentity({ subject: "did:privy:test-alice" })
        .mutation(api.users.completeOnboarding, {
          username: "bad username!",
          displayName: "Alice",
          walletAddress: WALLET_ALICE,
        }),
    ).rejects.toThrow()
  })
})

// ─── updateProfile ─────────────────────────────────────────────────────────

describe("users.updateProfile", () => {
  it("updates displayName and bio for the authenticated user", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", onboardedUser),
    )
    await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .mutation(api.users.updateProfile, {
        displayName: "Alice Updated",
        bio: "Hello world",
      })
    const user = await t.run(async (ctx) => ctx.db.get(userId))
    expect(user?.displayName).toBe("Alice Updated")
    expect(user?.bio).toBe("Hello world")
  })

  it("throws when called unauthenticated", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(api.users.updateProfile, {
        displayName: "Alice Updated",
        bio: "Hello world",
      }),
    ).rejects.toThrow("Not authenticated")
  })

  it("throws when the user record does not exist", async () => {
    const t = convexTest(schema, modules)
    // Insert then delete to get a stale user — identity resolves to DID
    // but the user row is gone
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", preOnboardingUser)
      await ctx.db.delete(id)
    })
    await expect(
      t
        .withIdentity({ subject: "did:privy:test-alice" })
        .mutation(api.users.updateProfile, {
          displayName: "Ghost",
          bio: "I do not exist",
        }),
    ).rejects.toThrow("User not found")
  })
})
