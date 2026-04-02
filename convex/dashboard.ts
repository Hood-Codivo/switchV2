import { query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"

export const getDashboardOverview = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return null
    }

    const user = await ctx.db.get(userId)
    if (!user) return null

    // Check for live stream
    const liveStream = await ctx.db
      .query("streams")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .filter((q) => q.eq(q.field("status"), "live"))
      .first()

    // Most recent ended stream
    const recentEndedStream = await ctx.db
      .query("streams")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "ended"))
      .first()

    // Count tips received (capped to avoid unbounded reads)
    const receivedTips = await ctx.db
      .query("tipTransactions")
      .withIndex("by_to_user", (q) => q.eq("toUserId", userId))
      .take(1000)

    // Unread notifications
    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read", (q) =>
        q.eq("userId", userId).eq("read", false),
      )
      .collect()

    return {
      isLive: liveStream !== null,
      recentStream: recentEndedStream
        ? {
            title: recentEndedStream.title,
            viewerCount: recentEndedStream.viewerCount,
            peakViewerCount: recentEndedStream.peakViewerCount,
            tipTotal: recentEndedStream.tipTotal ?? 0,
            startedAt: recentEndedStream.startedAt,
            endedAt: recentEndedStream.endedAt,
          }
        : null,
      followerCount: user.followerCount ?? 0,
      earningsSummary: {
        walletBalance: user.pointsBalance ?? 0,
        recentTipCount: receivedTips.length,
      },
      unreadNotificationCount: unreadNotifications.length,
    }
  },
})
