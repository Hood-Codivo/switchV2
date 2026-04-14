import { v } from "convex/values"
import { internalMutation, internalQuery, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"

const platformValidator = v.union(v.literal("youtube"), v.literal("x"))

// ─── Queries ────────────────────────────────────────────────────────────────

export const getConnectedPlatforms = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthenticatedUser(ctx)

    const connections = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()

    return connections.map((c) => ({
      _id: c._id,
      platform: c.platform,
      channelId: c.channelId,
      channelTitle: c.channelTitle,
      displayName: c.displayName,
      connectedAt: c.connectedAt,
      lastUsedAt: c.lastUsedAt,
      status: c.status,
    }))
  },
})

export const getPlatformByType = query({
  args: { platform: platformValidator },
  handler: async (ctx, { platform }) => {
    const userId = await getAuthenticatedUser(ctx)

    const connection = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) =>
        q.eq("userId", userId).eq("platform", platform),
      )
      .first()

    if (!connection) return null

    return {
      _id: connection._id,
      platform: connection.platform,
      channelId: connection.channelId,
      channelTitle: connection.channelTitle,
      displayName: connection.displayName,
      connectedAt: connection.connectedAt,
      lastUsedAt: connection.lastUsedAt,
      status: connection.status,
    }
  },
})

// ─── Internal Mutations ─────────────────────────────────────────────────────

export const storeConnection = internalMutation({
  args: {
    userId: v.id("users"),
    platform: platformValidator,
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiresAt: v.number(),
    channelId: v.string(),
    channelTitle: v.string(),
    displayName: v.string(),
    connectedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
  },
  handler: async (ctx, args) => {
    // Remove any existing connection for this user + platform
    const existing = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) =>
        q.eq("userId", args.userId).eq("platform", args.platform),
      )
      .first()
    if (existing) {
      await ctx.db.delete(existing._id)
    }

    return ctx.db.insert("connectedPlatforms", args)
  },
})

export const updateTokens = internalMutation({
  args: {
    connectionId: v.id("connectedPlatforms"),
    accessToken: v.string(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, { connectionId, accessToken, tokenExpiresAt }) => {
    await ctx.db.patch(connectionId, { accessToken, tokenExpiresAt, status: "active" })
  },
})

export const markExpired = internalMutation({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.patch(connectionId, { status: "expired" })
  },
})

export const removeConnection = internalMutation({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.delete(connectionId)
  },
})

// ─── Internal Queries ───────────────────────────────────────────────────────

export const getUserByPrivyDid = internalQuery({
  args: { privyDid: v.string() },
  handler: async (ctx, { privyDid }) => {
    return ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", privyDid))
      .unique()
  },
})

export const getRawConnection = internalQuery({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    return ctx.db.get(connectionId)
  },
})

export const getRawConnectionByUserAndPlatform = internalQuery({
  args: {
    userId: v.id("users"),
    platform: platformValidator,
  },
  handler: async (ctx, { userId, platform }) => {
    return ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) =>
        q.eq("userId", userId).eq("platform", platform),
      )
      .first()
  },
})

export const storeXManualRtmp = internalMutation({
  args: {
    userId: v.id("users"),
    rtmpUrl: v.string(),
    streamKeyEncrypted: v.string(),
    displayName: v.string(),
    connectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) => q.eq("userId", args.userId).eq("platform", "x"))
      .first()
    if (existing) await ctx.db.delete(existing._id)

    return ctx.db.insert("connectedPlatforms", {
      userId: args.userId,
      platform: "x",
      rtmpUrl: args.rtmpUrl,
      streamKey: args.streamKeyEncrypted,
      displayName: args.displayName,
      connectedAt: args.connectedAt,
      status: "active",
    })
  },
})
