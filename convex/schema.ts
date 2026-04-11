import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

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

export const streamStatusValidator = v.union(
  v.literal("idle"),
  v.literal("starting"),
  v.literal("live"),
  v.literal("ended"),
)

export const streamBillingStateValidator = v.union(
  v.literal("active"),
  v.literal("grace"),
  v.literal("exhausted"),
  v.literal("completed"),
)

// "ending" is intentionally absent — it exists only as local UI state in
// use-go-live.ts (GoLiveState) and is never persisted to Convex.
export type StreamStatus = "idle" | "starting" | "live" | "ended"

export default defineSchema({
  streams: defineTable({
    creatorId: v.id("users"),
    username: v.string(),
    title: v.string(),
    category: categoryValidator,
    status: streamStatusValidator,
    playbackUrl: v.optional(v.string()),
    rtkLivestreamId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    viewerCount: v.number(),
    peakViewerCount: v.number(),
    tipTotal: v.optional(v.number()),           // running total of tips received this stream
    slowModeInterval: v.optional(v.number()), // seconds between messages, 0 or absent = off
    chatClearedAt: v.optional(v.number()),    // timestamp; messages before this are hidden
    spendingLimitMinutes: v.optional(v.number()),
    allowExtraUsageSpending: v.optional(v.boolean()),
    spendingLimitUsd: v.optional(v.number()),
    spendingLimitSwtdAmount: v.optional(v.string()),
    billingState: v.optional(streamBillingStateValidator),
    chargedMinutes: v.optional(v.number()),
    remainingApprovedMinutes: v.optional(v.number()),
    chargeBlockMinutes: v.optional(v.number()),
    nextChargeAt: v.optional(v.number()),
    graceStartedAt: v.optional(v.number()),
    spendingApprovedAt: v.optional(v.number()),
    spendingApprovalSignature: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_creator", ["creatorId"])
    .index("by_username", ["username"])
    // Compound index for future queries that filter by both username and status.
    // getByUsername still uses by_username + .filter(neq "ended") because
    // Convex index ranges support equality/range predicates but not neq,
    // and per-creator stream counts are small in practice.
    .index("by_username_and_status", ["username", "status"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["status", "category"],
    }),
  streamViewers: defineTable({
    streamId: v.id("streams"),
    sessionId: v.string(),
    lastSeen: v.number(),
  })
    .index("by_stream", ["streamId"])
    .index("by_session", ["sessionId"])
    .index("by_last_seen", ["lastSeen"]),
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
    lastHeartbeatAt: v.optional(v.number()),
    spendingLimitMinutes: v.optional(v.number()),
    allowExtraUsageSpending: v.optional(v.boolean()),
    spendingLimitUsd: v.optional(v.number()),
    spendingLimitSwtdAmount: v.optional(v.string()),
    billingState: v.optional(streamBillingStateValidator),
    chargedMinutes: v.optional(v.number()),
    remainingApprovedMinutes: v.optional(v.number()),
    chargeBlockMinutes: v.optional(v.number()),
    nextChargeAt: v.optional(v.number()),
    graceStartedAt: v.optional(v.number()),
    spendingApprovedAt: v.optional(v.number()),
    spendingApprovalSignature: v.optional(v.string()),
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
  chatMessages: defineTable({
    streamId: v.id("streams"),
    userId: v.id("users"),
    username: v.string(),
    content: v.string(),
    isHidden: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_stream", ["streamId"])
    .index("by_stream_and_created", ["streamId", "createdAt"])
    .index("by_user_and_stream", ["userId", "streamId"]),
  chatModerations: defineTable({
    streamId: v.id("streams"),
    userId: v.id("users"),
    type: v.union(v.literal("ban"), v.literal("timeout")),
    expiresAt: v.optional(v.number()), // undefined = permanent (ban)
    createdAt: v.number(),
  })
    .index("by_stream_and_user", ["streamId", "userId"]),
  tipTransactions: defineTable({
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    streamId: v.id("streams"),
    amount: v.number(),
    message: v.optional(v.string()),
    solanaSignature: v.optional(v.string()), // Phase 3 — nullable until Solana integration
    tokenMint: v.optional(v.string()),       // Phase 3 — nullable until Solana integration
    createdAt: v.number(),
  })
    .index("by_stream", ["streamId"])
    .index("by_from_user", ["fromUserId"])
    .index("by_to_user", ["toUserId"]),
  tipAlerts: defineTable({
    streamId: v.id("streams"),
    fromUsername: v.string(),
    amount: v.number(),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_stream", ["streamId"]),
  notifications: defineTable({
    userId: v.id("users"),
    type: v.literal("go-live"),
    streamId: v.id("streams"),
    creatorId: v.id("users"),
    creatorName: v.string(),
    creatorUsername: v.string(),
    streamTitle: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_read", ["userId", "read"]),
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dhKey: v.string(),
    authKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),
  backstageMessages: defineTable({
    sessionId: v.id("studioSessions"),
    senderType: v.union(v.literal("creator"), v.literal("guest")),
    senderId: v.string(),   // userId for creator, guestId string for guest
    senderName: v.string(), // display name at time of sending
    content: v.string(),
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),
  follows: defineTable({
    followerId: v.id("users"),
    creatorId: v.id("users"),
  })
    .index("by_follower", ["followerId"])
    .index("by_creator", ["creatorId"])
    .index("by_follower_and_creator", ["followerId", "creatorId"]),
  users: defineTable({
    privyDid: v.string(),
    walletAddress: v.string(),
    username: v.optional(v.string()),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatarUrl: v.optional(v.union(v.string(), v.null())),
    pointsBalance: v.optional(v.number()),
    followerCount: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    // Stream preferences
    defaultCategory: v.optional(categoryValidator),
    defaultSlowModeInterval: v.optional(v.number()),
    // Notification preferences
    notifyGoLive: v.optional(v.boolean()),
    notifyTips: v.optional(v.boolean()),
  })
    .index("by_privyDid", ["privyDid"])
    .index("by_username", ["username"]),
  connectedPlatforms: defineTable({
    userId: v.id("users"),
    platform: v.union(v.literal("youtube"), v.literal("x")),

    // OAuth tokens (encrypted before storage with AES-256-GCM)
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),

    // Manual RTMP (for X later)
    rtmpUrl: v.optional(v.string()),
    streamKey: v.optional(v.string()),

    // Platform-specific metadata
    channelId: v.optional(v.string()),
    channelTitle: v.optional(v.string()),

    // Common
    displayName: v.optional(v.string()),
    connectedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_platform", ["userId", "platform"]),
})
