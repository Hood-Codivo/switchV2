import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api, internal } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

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

describe("connected-platforms mutations", () => {
  it("stores a YouTube connection and retrieves it without tokens", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await t.run(async (ctx) => {
      await ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "youtube",
        accessToken: "encrypted-access",
        refreshToken: "encrypted-refresh",
        tokenExpiresAt: Date.now() + 3600_000,
        channelId: "UC1234",
        channelTitle: "Alice's Channel",
        displayName: "Alice's Channel",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    const platforms = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.connectedPlatforms.getConnectedPlatforms, {})

    expect(platforms).toHaveLength(1)
    expect(platforms[0].platform).toBe("youtube")
    expect(platforms[0].channelTitle).toBe("Alice's Channel")
    expect(platforms[0].displayName).toBe("Alice's Channel")
    expect(platforms[0].status).toBe("active")
    expect(platforms[0]).not.toHaveProperty("accessToken")
    expect(platforms[0]).not.toHaveProperty("refreshToken")
  })

  it("retrieves a single platform by type", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "bob"))

    await t.run(async (ctx) => {
      await ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "youtube",
        channelId: "UC5678",
        channelTitle: "Bob Streams",
        displayName: "Bob Streams",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    const yt = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.connectedPlatforms.getPlatformByType, { platform: "youtube" })

    expect(yt).not.toBeNull()
    expect(yt?.channelTitle).toBe("Bob Streams")
    expect(yt).not.toHaveProperty("accessToken")
  })

  it("returns null for a platform the user has not connected", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, "carol"))

    const yt = await t
      .withIdentity({ subject: "did:privy:test-carol" })
      .query(api.connectedPlatforms.getPlatformByType, { platform: "youtube" })

    expect(yt).toBeNull()
  })

  it("removes a connection", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "dave"))

    const connectionId = await t.run(async (ctx) => {
      return ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "youtube",
        channelId: "UC9999",
        channelTitle: "Dave Live",
        displayName: "Dave Live",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    await t.mutation(internal.connectedPlatforms.removeConnection, {
      connectionId,
    })

    const platforms = await t
      .withIdentity({ subject: "did:privy:test-dave" })
      .query(api.connectedPlatforms.getConnectedPlatforms, {})

    expect(platforms).toHaveLength(0)
  })
})
