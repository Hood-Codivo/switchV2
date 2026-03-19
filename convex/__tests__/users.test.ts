import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// Minimal user record as @convex-dev/auth creates it on first OAuth sign-in
const authCreatedUser = { email: "alice@example.com" }

// Fully onboarded user record
const onboardedUser = {
  username: "alice",
  displayName: "Alice",
  bio: "",
  avatarUrl: null as null,
  pointsBalance: 0,
  createdAt: Date.now(),
}

// ─── getCurrentUser ────────────────────────────────────────────────────────

describe("users.getCurrentUser", () => {
  it("returns null when the authenticated user has not completed onboarding", async () => {
    const t = convexTest(schema, modules)
    // Simulate the record @convex-dev/auth creates on first sign-in (no username yet)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", authCreatedUser),
    )
    const user = await t
      .withIdentity({ subject: userId })
      .query(api.users.getCurrentUser, {})
    expect(user).toBeNull()
  })

  it("returns the user record for a fully onboarded user", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", onboardedUser),
    )
    const user = await t
      .withIdentity({ subject: userId })
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
  it("patches the auth-created user record with profile data", async () => {
    const t = convexTest(schema, modules)
    // @convex-dev/auth creates the record first; identity.subject IS the _id
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", authCreatedUser),
    )
    await t
      .withIdentity({ subject: userId })
      .mutation(api.users.completeOnboarding, {
        username: "alice",
        displayName: "Alice",
      })
    const user = await t.run(async (ctx) => ctx.db.get(userId))
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
      }),
    ).rejects.toThrow("Not authenticated")
  })

  it("throws if username is already taken", async () => {
    const t = convexTest(schema, modules)
    // Alice already claimed the username
    await t.run(async (ctx) => ctx.db.insert("users", onboardedUser))
    // Bob tries to claim the same username
    const bobId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "bob@example.com" }),
    )
    await expect(
      t
        .withIdentity({ subject: bobId })
        .mutation(api.users.completeOnboarding, {
          username: "alice",
          displayName: "Bob",
        }),
    ).rejects.toThrow("Username is already taken")
  })

  it("throws if username fails format validation", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", authCreatedUser),
    )
    await expect(
      t
        .withIdentity({ subject: userId })
        .mutation(api.users.completeOnboarding, {
          username: "bad username!",
          displayName: "Alice",
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
      .withIdentity({ subject: userId })
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
    // Insert then delete to get a valid-format but stale ID
    const staleId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", authCreatedUser)
      await ctx.db.delete(id)
      return id
    })
    await expect(
      t
        .withIdentity({ subject: staleId })
        .mutation(api.users.updateProfile, {
          displayName: "Ghost",
          bio: "I do not exist",
        }),
    ).rejects.toThrow("User not found")
  })
})
