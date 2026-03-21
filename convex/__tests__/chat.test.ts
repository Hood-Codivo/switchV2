import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedUser(ctx: GenericMutationCtx<DataModel>, username: string): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    username,
    displayName: username,
    createdAt: Date.now(),
  })
}

async function seedLiveStream(
  ctx: GenericMutationCtx<DataModel>,
  creatorId: Id<"users">,
  username: string,
): Promise<Id<"streams">> {
  return ctx.db.insert("streams", {
    creatorId,
    username,
    title: "Test Stream",
    category: "Gaming",
    status: "live",
    playbackUrl: "https://example.com/manifest.m3u8",
    startedAt: Date.now(),
    viewerCount: 0,
    peakViewerCount: 0,
  })
}

// ─── sendMessage ──────────────────────────────────────────────────────────────

describe("chat.sendMessage", () => {
  it("authenticated user can send a message to a live stream", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    const msgId = await t
      .withIdentity({ subject: viewerId })
      .mutation(api.chat.sendMessage, { streamId, content: "Hello stream!" })

    const msg = await t.run(async (ctx) => ctx.db.get(msgId))
    expect(msg).not.toBeNull()
    expect(msg?.content).toBe("Hello stream!")
    expect(msg?.username).toBe("viewer")
    expect(msg?.userId).toBe(viewerId)
    expect(msg?.streamId).toBe(streamId)
    expect(msg?.isHidden).toBe(false)
  })

  it("unauthenticated user cannot send messages", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await expect(
      t.mutation(api.chat.sendMessage, { streamId, content: "Hello" }),
    ).rejects.toThrow("Sign in")
  })

  it("rejects messages on non-live streams", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) =>
      ctx.db.insert("streams", {
        creatorId,
        username: "creator",
        title: "Ended Stream",
        category: "Gaming",
        status: "ended",
        viewerCount: 0,
        peakViewerCount: 0,
        endedAt: Date.now(),
      }),
    )
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
        streamId,
        content: "Hello",
      }),
    ).rejects.toThrow("live")
  })

  it("trims whitespace and rejects empty messages", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
        streamId,
        content: "   ",
      }),
    ).rejects.toThrow("empty")
  })
})

// ─── listMessages ─────────────────────────────────────────────────────────────

describe("chat.listMessages", () => {
  it("returns messages for a stream ordered by creation time", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "First",
    })
    await t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "Second",
    })

    const messages = await t.query(api.chat.listMessages, { streamId })

    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe("First")
    expect(messages[1].content).toBe("Second")
  })

  it("does not return hidden messages", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    const msgId = await t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "Visible",
    })
    // Manually hide a message to test filtering
    await t.run(async (ctx) => ctx.db.patch(msgId, { isHidden: true }))

    const messages = await t.query(api.chat.listMessages, { streamId })
    expect(messages).toHaveLength(0)
  })
})

// ─── moderation: ban ──────────────────────────────────────────────────────────

describe("chat.moderateUser (ban)", () => {
  it("creator can ban a viewer; banned viewer cannot send messages", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    // Ban the viewer
    await t.withIdentity({ subject: creatorId }).mutation(api.chat.moderateUser, {
      streamId,
      userId: viewerId,
      action: "ban",
    })

    // Banned viewer should be rejected
    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
        streamId,
        content: "I'm banned",
      }),
    ).rejects.toThrow("banned")
  })

  it("non-creator cannot ban a user", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))
    const otherViewerId = await t.run(async (ctx) => seedUser(ctx, "other"))

    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.moderateUser, {
        streamId,
        userId: otherViewerId,
        action: "ban",
      }),
    ).rejects.toThrow()
  })
})

// ─── moderation: timeout ──────────────────────────────────────────────────────

describe("chat.moderateUser (timeout)", () => {
  it("timed-out user cannot send messages during timeout", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    // Timeout for 60 seconds
    await t.withIdentity({ subject: creatorId }).mutation(api.chat.moderateUser, {
      streamId,
      userId: viewerId,
      action: "timeout",
      duration: 60,
    })

    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
        streamId,
        content: "I'm timed out",
      }),
    ).rejects.toThrow("timed out")
  })

  it("expired timeout allows sending again", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    // Insert an already-expired timeout (expiresAt in the past)
    await t.run(async (ctx) =>
      ctx.db.insert("chatModerations", {
        streamId,
        userId: viewerId,
        type: "timeout",
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 61_000,
      }),
    )

    // Should succeed — timeout has expired
    const msgId = await t
      .withIdentity({ subject: viewerId })
      .mutation(api.chat.sendMessage, { streamId, content: "I'm back!" })

    const msg = await t.run(async (ctx) => ctx.db.get(msgId))
    expect(msg?.content).toBe("I'm back!")
  })
})

// ─── slow mode ────────────────────────────────────────────────────────────────

describe("chat.setSlowMode", () => {
  it("creator can enable slow mode; rapid messages from viewers are rejected", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    // Enable 30s slow mode
    await t.withIdentity({ subject: creatorId }).mutation(api.chat.setSlowMode, {
      streamId,
      interval: 30,
    })

    // First message should succeed
    await t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "First",
    })

    // Second immediate message should be rejected
    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
        streamId,
        content: "Too fast",
      }),
    ).rejects.toThrow("Slow mode")
  })

  it("creator is exempt from slow mode", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    await t.withIdentity({ subject: creatorId }).mutation(api.chat.setSlowMode, {
      streamId,
      interval: 30,
    })

    // Creator sends two rapid messages — both should succeed
    await t.withIdentity({ subject: creatorId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "Creator msg 1",
    })
    await t.withIdentity({ subject: creatorId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "Creator msg 2",
    })

    const messages = await t.query(api.chat.listMessages, { streamId })
    expect(messages).toHaveLength(2)
  })

  it("non-creator cannot set slow mode", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.setSlowMode, {
        streamId,
        interval: 30,
      }),
    ).rejects.toThrow()
  })
})

// ─── clearChat ────────────────────────────────────────────────────────────────

describe("chat.clearChat", () => {
  it("creator can clear all messages; they no longer appear in listMessages", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "Hello",
    })
    await t.withIdentity({ subject: viewerId }).mutation(api.chat.sendMessage, {
      streamId,
      content: "World",
    })

    // Clear
    await t.withIdentity({ subject: creatorId }).mutation(api.chat.clearChat, { streamId })

    const messages = await t.query(api.chat.listMessages, { streamId })
    expect(messages).toHaveLength(0)
  })

  it("non-creator cannot clear chat", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await expect(
      t.withIdentity({ subject: viewerId }).mutation(api.chat.clearChat, { streamId }),
    ).rejects.toThrow()
  })
})

// ─── getModerationState ───────────────────────────────────────────────────────

describe("chat.getModerationState", () => {
  it("returns banned=true for a banned user", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await t.withIdentity({ subject: creatorId }).mutation(api.chat.moderateUser, {
      streamId,
      userId: viewerId,
      action: "ban",
    })

    const state = await t
      .withIdentity({ subject: viewerId })
      .query(api.chat.getModerationState, { streamId })

    expect(state.banned).toBe(true)
  })

  it("returns timedOutUntil for an active timeout", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))
    const viewerId = await t.run(async (ctx) => seedUser(ctx, "viewer"))

    await t.withIdentity({ subject: creatorId }).mutation(api.chat.moderateUser, {
      streamId,
      userId: viewerId,
      action: "timeout",
      duration: 300,
    })

    const state = await t
      .withIdentity({ subject: viewerId })
      .query(api.chat.getModerationState, { streamId })

    expect(state.banned).toBe(false)
    expect(state.timedOutUntil).toBeGreaterThan(Date.now())
  })

  it("returns clean state for unauthenticated user", async () => {
    const t = convexTest(schema, modules)
    const creatorId = await t.run(async (ctx) => seedUser(ctx, "creator"))
    const streamId = await t.run(async (ctx) => seedLiveStream(ctx, creatorId, "creator"))

    const state = await t.query(api.chat.getModerationState, { streamId })
    expect(state.banned).toBe(false)
    expect(state.timedOutUntil).toBeNull()
  })
})
