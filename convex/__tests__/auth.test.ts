import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

const testUser = {
  privyDid: "did:privy:test123",
  walletAddress: "So1anaWa11etAddr3ss",
  username: "alice",
  displayName: "Alice",
  bio: "",
  avatarUrl: null as null,
  pointsBalance: 0,
  followerCount: 0,
  createdAt: Date.now(),
}

// ─── getAuthenticatedUser (via getCurrentUser) ──────────────────────────────

describe("identity resolution", () => {
  it("resolves a valid Privy DID to the correct user", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", testUser),
    )
    const user = await t
      .withIdentity({ subject: "did:privy:test123" })
      .query(api.users.getCurrentUser, {})
    expect(user).not.toBeNull()
    expect(user?._id).toBe(userId)
    expect(user?.username).toBe("alice")
  })

  it("returns null when no identity is present (unauthenticated)", async () => {
    const t = convexTest(schema, modules)
    const user = await t.query(api.users.getCurrentUser, {})
    expect(user).toBeNull()
  })

  it("throws when identity exists but no Convex user matches the DID", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t
        .withIdentity({ subject: "did:privy:nonexistent" })
        .mutation(api.users.updateProfile, {
          displayName: "Ghost",
          bio: "I do not exist",
        }),
    ).rejects.toThrow("User not found")
  })

  it("throws when called without authentication", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(api.users.updateProfile, {
        displayName: "Ghost",
        bio: "nope",
      }),
    ).rejects.toThrow("Not authenticated")
  })

  it("throws when identity has an empty subject claim", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t
        .withIdentity({ subject: "" })
        .mutation(api.users.updateProfile, {
          displayName: "Ghost",
          bio: "no subject",
        }),
    ).rejects.toThrow("Missing subject claim in identity")
  })
})
