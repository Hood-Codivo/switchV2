import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"

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
    const followerId = await getAuthUserId(ctx)
    if (!followerId) throw new Error("Not authenticated")
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
    const followerId = await getAuthUserId(ctx)
    if (!followerId) throw new Error("Not authenticated")

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
    const followerId = await getAuthUserId(ctx)
    if (!followerId) return false

    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_and_creator", (q) =>
        q.eq("followerId", followerId).eq("creatorId", creatorId),
      )
      .unique()
    return existing !== null
  },
})
