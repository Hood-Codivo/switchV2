import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"
import { validateUsername } from "./lib/username"

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    // Return null for users who haven't completed onboarding yet
    if (!user?.username) return null
    return user
  },
})

// Returns Google OAuth profile data before onboarding is complete.
// Used to pre-fill the onboarding form with the user's real name.
export const getGoogleProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    return { name: user.name ?? null, image: user.image ?? null }
  },
})

export const checkUsernameAvailable = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique()
    return existing === null
  },
})

export const completeOnboarding = mutation({
  args: {
    username: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { username, displayName }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const validation = validateUsername(username)
    if (!validation.valid) throw new Error(validation.error)

    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique()
    if (existing !== null) throw new Error("Username is already taken")

    // @convex-dev/auth already created the user row on OAuth sign-in.
    // We patch it with the profile data the user chose during onboarding.
    await ctx.db.patch(userId, {
      username,
      displayName,
      bio: "",
      avatarUrl: null,
      pointsBalance: 0,
      createdAt: Date.now(),
    })
  },
})

export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.string(),
  },
  handler: async (ctx, { displayName, bio }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const user = await ctx.db.get(userId)
    if (!user) throw new Error("User not found")

    await ctx.db.patch(user._id, { displayName, bio })
  },
})
