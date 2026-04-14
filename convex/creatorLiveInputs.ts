import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"

export const getForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("creatorLiveInputs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first()
  },
})

export const upsertForUser = internalMutation({
  args: {
    userId: v.id("users"),
    cloudflareLiveInputUid: v.string(),
    rtmpsUrl: v.string(),
    streamKeyEncrypted: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creatorLiveInputs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        cloudflareLiveInputUid: args.cloudflareLiveInputUid,
        rtmpsUrl: args.rtmpsUrl,
        streamKeyEncrypted: args.streamKeyEncrypted,
        lastUsedAt: Date.now(),
      })
      return existing._id
    }
    return ctx.db.insert("creatorLiveInputs", {
      ...args,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })
  },
})
