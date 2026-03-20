import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"

// ─── sendBackstageMessage ─────────────────────────────────────────────────────

export const sendBackstageMessage = mutation({
  args: {
    sessionId: v.id("studioSessions"),
    content: v.string(),
    guestId: v.optional(v.id("studioGuests")),
  },
  handler: async (ctx, { sessionId, content, guestId }) => {
    if (!content.trim()) throw new Error("Message cannot be empty")

    const session = await ctx.db.get(sessionId)
    if (!session || session.status !== "active") throw new Error("Session not found or ended")

    // Creator path
    const userId = await getAuthUserId(ctx)
    if (userId) {
      if (session.creatorId !== userId) throw new Error("Not authorized")
      const user = await ctx.db.get(userId)
      await ctx.db.insert("backstageMessages", {
        sessionId,
        senderType: "creator",
        senderId: userId,
        senderName: user?.displayName ?? user?.name ?? "Creator",
        content,
        createdAt: Date.now(),
      })
      return
    }

    // Guest path
    if (!guestId) throw new Error("Not authenticated")
    const guest = await ctx.db.get(guestId)
    if (!guest || guest.sessionId !== sessionId || guest.status !== "admitted") {
      throw new Error("Not authorized")
    }
    await ctx.db.insert("backstageMessages", {
      sessionId,
      senderType: "guest",
      senderId: guestId,
      senderName: guest.displayName,
      content,
      createdAt: Date.now(),
    })
  },
})

// ─── listBackstageMessages ────────────────────────────────────────────────────

export const listBackstageMessages = query({
  args: {
    sessionId: v.id("studioSessions"),
    guestId: v.optional(v.id("studioGuests")),
  },
  handler: async (ctx, { sessionId, guestId }) => {
    const session = await ctx.db.get(sessionId)
    if (!session) return []

    // Creator path
    const userId = await getAuthUserId(ctx)
    if (userId) {
      if (session.creatorId !== userId) return []
      return ctx.db
        .query("backstageMessages")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .order("asc")
        .collect()
    }

    // Guest path
    if (!guestId) return []
    const guest = await ctx.db.get(guestId)
    if (!guest || guest.sessionId !== sessionId || guest.status !== "admitted") return []
    return ctx.db
      .query("backstageMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect()
  },
})
