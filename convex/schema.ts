import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server"

export const CATEGORIES = [
  "Gaming",
  "Podcast",
  "Education",
  "IRL",
  "Music",
  "Business",
  "Tech",
  "Other",
] as const

export type StreamCategory = (typeof CATEGORIES)[number]

export const categoryValidator = v.union(
  v.literal("Gaming"),
  v.literal("Podcast"),
  v.literal("Education"),
  v.literal("IRL"),
  v.literal("Music"),
  v.literal("Business"),
  v.literal("Tech"),
  v.literal("Other"),
)

export default defineSchema({
  ...authTables,
  streams: defineTable({
    creatorId: v.id("users"),
    title: v.string(),
    category: categoryValidator,
    isLive: v.boolean(),
    viewerCount: v.number(),
    playbackUrl: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  })
    .index("by_is_live_and_viewer_count", ["isLive", "viewerCount"])
    .index("by_creator", ["creatorId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["isLive", "category"],
    }),
  studioSessions: defineTable({
    creatorId: v.id("users"),
    cloudflareRoomId: v.string(),
    creatorAuthToken: v.string(),
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAt: v.number(),
    inviteToken: v.optional(v.string()),
    inviteTokenExpiresAt: v.optional(v.number()),
    streamId: v.optional(v.id("streams")),
    // Canvas stage sync — persisted so guests see the same composition as the host
    stageParticipantIds: v.optional(v.array(v.string())), // "${customParticipantId}:camera" or "${customParticipantId}:screen" per slot
    stageLayoutId: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"])
    .index("by_invite_token", ["inviteToken"]),
  studioGuests: defineTable({
    sessionId: v.id("studioSessions"),
    displayName: v.string(),
    rtkAuthToken: v.optional(v.string()),
    status: v.union(
      v.literal("waiting"),
      v.literal("admitted"),
      v.literal("rejected"),
      v.literal("removed"),
    ),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_status", ["sessionId", "status"]),
  follows: defineTable({
    followerId: v.id("users"),
    creatorId: v.id("users"),
  })
    .index("by_follower", ["followerId"])
    .index("by_creator", ["creatorId"])
    .index("by_follower_and_creator", ["followerId", "creatorId"]),
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
    followerCount: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("email", ["email"]) // required by @convex-dev/auth
    .index("by_username", ["username"]),
})
