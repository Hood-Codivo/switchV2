import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server"

export default defineSchema({
  ...authTables,
  // Extends the authTables users table with our custom fields.
  // @convex-dev/auth creates the user record on first OAuth sign-in with email etc.
  // Our completeOnboarding mutation patches it with username, displayName, etc.
  users: defineTable({
    // Fields managed by @convex-dev/auth (required)
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // OAuth profile fields stored by @convex-dev/auth
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    // Our custom fields (optional until onboarding is complete)
    username: v.optional(v.string()),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatarUrl: v.optional(v.union(v.string(), v.null())),
    pointsBalance: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("email", ["email"]) // required by @convex-dev/auth
    .index("by_username", ["username"]),
})
