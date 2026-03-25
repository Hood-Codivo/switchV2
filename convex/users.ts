import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"
import { validateUsername } from "./lib/username"

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    let userId
    try {
      userId = await getAuthenticatedUser(ctx)
    } catch {
      return null
    }
    const user = await ctx.db.get(userId)
    // Return null for users who haven't completed onboarding yet
    if (!user?.username) return null
    return user
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
    walletAddress: v.string(),
  },
  handler: async (ctx, { username, displayName, walletAddress }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const privyDid = identity.subject
    if (!privyDid) throw new Error("Missing subject claim in identity")

    const validation = validateUsername(username)
    if (!validation.valid) throw new Error(validation.error)

    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique()
    if (existing !== null) throw new Error("Username is already taken")

    // Privy handles login + wallet creation. We create the Convex user
    // record during onboarding with the Privy DID and wallet address.
    await ctx.db.insert("users", {
      privyDid,
      walletAddress,
      username,
      displayName,
      bio: "",
      avatarUrl: null,
      pointsBalance: 0,
      followerCount: 0,
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
    const userId = await getAuthenticatedUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("User not found")

    await ctx.db.patch(user._id, { displayName, bio })
  },
})
