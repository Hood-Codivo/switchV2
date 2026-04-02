import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"
import type { Id } from "./_generated/dataModel"

type FollowUserInfo = {
  _id: Id<"users">
  username: string | undefined
  displayName: string | undefined
  avatarUrl: string | null | undefined
}

export const listFollowers = query({
  args: {},
  handler: async (ctx): Promise<FollowUserInfo[]> => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return []
    }

    const follows = await ctx.db
      .query("follows")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .collect()

    const users = await Promise.all(follows.map((f) => ctx.db.get(f.followerId)))
    return users
      .filter((u) => u !== null)
      .map((u) => ({
        _id: u._id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
      }))
  },
})

export const listFollowing = query({
  args: {},
  handler: async (ctx): Promise<FollowUserInfo[]> => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return []
    }

    const follows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", userId))
      .collect()

    const users = await Promise.all(follows.map((f) => ctx.db.get(f.creatorId)))
    return users
      .filter((u) => u !== null)
      .map((u) => ({
        _id: u._id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
      }))
  },
})

export const removeFollower = mutation({
  args: { followerId: v.id("users") },
  handler: async (ctx, { followerId }) => {
    const creatorId = await getAuthenticatedUser(ctx)

    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_and_creator", (q) =>
        q.eq("followerId", followerId).eq("creatorId", creatorId),
      )
      .unique()
    if (!existing) return // not a follower — no-op

    await ctx.db.delete(existing._id)

    const creator = await ctx.db.get(creatorId)
    if (creator) {
      await ctx.db.patch(creatorId, {
        followerCount: Math.max(0, (creator.followerCount ?? 0) - 1),
      })
    }
  },
})

export const getChannelPage = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique()
    if (!user) return null

    return { user, followerCount: user.followerCount ?? 0 }
  },
})

export const followUser = mutation({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    const followerId = await getAuthenticatedUser(ctx)
    if (followerId === creatorId) throw new Error("Cannot follow yourself")

    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_and_creator", (q) =>
        q.eq("followerId", followerId).eq("creatorId", creatorId),
      )
      .unique()
    if (existing) return // already following — idempotent

    await ctx.db.insert("follows", { followerId, creatorId })

    const creator = await ctx.db.get(creatorId)
    if (creator) {
      await ctx.db.patch(creatorId, { followerCount: (creator.followerCount ?? 0) + 1 })
    }
  },
})

export const unfollowUser = mutation({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    const followerId = await getAuthenticatedUser(ctx)

    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_and_creator", (q) =>
        q.eq("followerId", followerId).eq("creatorId", creatorId),
      )
      .unique()
    if (!existing) return // not following — no-op

    await ctx.db.delete(existing._id)

    const creator = await ctx.db.get(creatorId)
    if (creator) {
      await ctx.db.patch(creatorId, { followerCount: Math.max(0, (creator.followerCount ?? 0) - 1) })
    }
  },
})

export const getFollowState = query({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    let followerId
    try {
      followerId = await getAuthenticatedUser(ctx)
    } catch {
      return false
    }

    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_and_creator", (q) =>
        q.eq("followerId", followerId).eq("creatorId", creatorId),
      )
      .unique()
    return existing !== null
  },
})
