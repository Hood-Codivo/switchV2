import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"
import { validateUsername } from "./lib/username"
import { categoryValidator } from "./schema"

// Solana addresses are base58-encoded ed25519 public keys (32–44 chars).
// This regex rejects non-base58 characters (0, O, I, l are excluded by base58).
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

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

    if (!SOLANA_ADDRESS_REGEX.test(walletAddress)) {
      throw new Error("Invalid Solana wallet address")
    }

    const existingDid = await ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", privyDid))
      .unique()
    if (existingDid !== null) throw new Error("Account already exists for this identity")

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
    avatarStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { displayName, bio, avatarStorageId }) => {
    const userId = await getAuthenticatedUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("User not found")

    const patch: { displayName: string; bio: string; avatarUrl?: string | null } = {
      displayName,
      bio,
    }

    if (avatarStorageId !== undefined) {
      const url = await ctx.storage.getUrl(avatarStorageId)
      if (!url) throw new Error("Failed to get URL for uploaded file")
      patch.avatarUrl = url
    }

    await ctx.db.patch(user._id, patch)
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthenticatedUser(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const updateStreamPreferences = mutation({
  args: {
    defaultCategory: categoryValidator,
    defaultSlowModeInterval: v.number(),
  },
  handler: async (ctx, { defaultCategory, defaultSlowModeInterval }) => {
    const userId = await getAuthenticatedUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("User not found")

    if (defaultSlowModeInterval < 0) {
      throw new Error("Slow mode interval must be non-negative")
    }

    await ctx.db.patch(user._id, { defaultCategory, defaultSlowModeInterval })
  },
})

export const updateNotificationPreferences = mutation({
  args: {
    notifyGoLive: v.boolean(),
    notifyTips: v.boolean(),
  },
  handler: async (ctx, { notifyGoLive, notifyTips }) => {
    const userId = await getAuthenticatedUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("User not found")

    await ctx.db.patch(user._id, { notifyGoLive, notifyTips })
  },
})
