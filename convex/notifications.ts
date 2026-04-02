import { v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"
import { internal } from "./_generated/api"

// ─── list ─────────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return []
    }

    return ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50)
  },
})

// ─── getUnreadCount ───────────────────────────────────────────────────────────

export const getUnreadCount = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return 0
    }

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read", (q) => q.eq("userId", userId).eq("read", false))
      .collect()

    return unread.length
  },
})

// ─── markRead ─────────────────────────────────────────────────────────────────

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const userId = await getAuthenticatedUser(ctx)

    const notification = await ctx.db.get(notificationId)
    if (!notification) throw new Error("Notification not found")
    if (notification.userId !== userId) throw new Error("Not authorized")

    await ctx.db.patch(notificationId, { read: true })
  },
})

// ─── markAllRead ──────────────────────────────────────────────────────────────

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthenticatedUser(ctx)

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read", (q) => q.eq("userId", userId).eq("read", false))
      .collect()

    await Promise.all(unread.map((n) => ctx.db.patch(n._id, { read: true })))
  },
})

// ─── savePushSubscription ─────────────────────────────────────────────────────

export const savePushSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dhKey: v.string(),
    authKey: v.string(),
  },
  handler: async (ctx, { endpoint, p256dhKey, authKey }) => {
    const userId = await getAuthenticatedUser(ctx)

    // Deduplicate by endpoint — replace if already exists
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dhKey, authKey })
    } else {
      await ctx.db.insert("pushSubscriptions", {
        userId,
        endpoint,
        p256dhKey,
        authKey,
        createdAt: Date.now(),
      })
    }
  },
})

// ─── fanOutGoLiveNotifications ────────────────────────────────────────────────
// Called from streams.setLive (or a scheduled function) when a stream goes live.
// Creates an in-app notification for each follower.

export const fanOutGoLiveNotifications = internalMutation({
  args: {
    streamId: v.id("streams"),
    creatorId: v.id("users"),
    creatorName: v.string(),
    creatorUsername: v.string(),
    streamTitle: v.string(),
  },
  handler: async (ctx, { streamId, creatorId, creatorName, creatorUsername, streamTitle }) => {
    const followers = await ctx.db
      .query("follows")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()

    const now = Date.now()
    await Promise.all(
      followers.map(async (f) => {
        // Respect the follower's notification preference
        const follower = await ctx.db.get(f.followerId)
        if (follower?.notifyGoLive === false) return

        return ctx.db.insert("notifications", {
          userId: f.followerId,
          type: "go-live",
          streamId,
          creatorId,
          creatorName,
          creatorUsername,
          streamTitle,
          read: false,
          createdAt: now,
        })
      }),
    )
  },
})
