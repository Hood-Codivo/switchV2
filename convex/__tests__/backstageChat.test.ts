import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { api } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

// ─── Helpers ────────────────────────────────────────────────────────────────

async function seedUser(ctx: GenericMutationCtx<DataModel>, username: string) {
  return ctx.db.insert("users", {
    username,
    displayName: username,
    createdAt: Date.now(),
  })
}

async function seedSession(
  ctx: GenericMutationCtx<DataModel>,
  creatorId: string,
  status: "active" | "ended" = "active",
) {
  return ctx.db.insert("studioSessions", {
    creatorId: creatorId as DataModel["studioSessions"]["document"]["creatorId"],
    cloudflareRoomId: "cf-room-1",
    creatorAuthToken: "token-1",
    status,
    createdAt: Date.now(),
  })
}

async function seedAdmittedGuest(
  ctx: GenericMutationCtx<DataModel>,
  sessionId: DataModel["studioSessions"]["document"]["_id"],
  displayName: string,
) {
  return ctx.db.insert("studioGuests", {
    sessionId,
    displayName,
    status: "admitted",
    createdAt: Date.now(),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("listBackstageMessages", () => {
  it("returns messages in creation order", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))
    const guestId = await t.run(async (ctx) => seedAdmittedGuest(ctx, sessionId, "Bob"))

    await t.withIdentity({ subject: userId }).mutation(api.backstageChat.sendBackstageMessage, {
      sessionId,
      content: "first",
    })
    await t.mutation(api.backstageChat.sendBackstageMessage, {
      sessionId,
      content: "second",
      guestId,
    })
    await t.withIdentity({ subject: userId }).mutation(api.backstageChat.sendBackstageMessage, {
      sessionId,
      content: "third",
    })

    const messages = await t.withIdentity({ subject: userId }).query(api.backstageChat.listBackstageMessages, {
      sessionId,
    })

    expect(messages).toHaveLength(3)
    expect(messages[0].content).toBe("first")
    expect(messages[1].content).toBe("second")
    expect(messages[2].content).toBe("third")
  })

  it("returns empty array for non-participant", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const otherId = await t.run(async (ctx) => seedUser(ctx, "eve"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))

    await t.withIdentity({ subject: userId }).mutation(api.backstageChat.sendBackstageMessage, {
      sessionId,
      content: "secret",
    })

    const messages = await t.withIdentity({ subject: otherId }).query(api.backstageChat.listBackstageMessages, {
      sessionId,
    })

    expect(messages).toHaveLength(0)
  })

  it("removed guest cannot send a message", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))
    const guestId = await t.run(async (ctx) =>
      ctx.db.insert("studioGuests", {
        sessionId,
        displayName: "Removed",
        status: "removed",
        createdAt: Date.now(),
      }),
    )

    await expect(
      t.mutation(api.backstageChat.sendBackstageMessage, {
        sessionId,
        content: "should fail",
        guestId,
      }),
    ).rejects.toThrow()
  })
})

describe("sendBackstageMessage", () => {
  it("rejects empty or whitespace-only content", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))

    await expect(
      t.withIdentity({ subject: userId }).mutation(api.backstageChat.sendBackstageMessage, {
        sessionId,
        content: "   ",
      }),
    ).rejects.toThrow("Message cannot be empty")
  })


  it("admitted guest can send a message and it appears in the list", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))
    const guestId = await t.run(async (ctx) => seedAdmittedGuest(ctx, sessionId, "Bob"))

    await t.mutation(api.backstageChat.sendBackstageMessage, {
      sessionId,
      content: "hey from Bob",
      guestId,
    })

    const messages = await t.withIdentity({ subject: userId }).query(api.backstageChat.listBackstageMessages, {
      sessionId,
    })

    expect(messages).toHaveLength(1)
    expect(messages[0].senderType).toBe("guest")
    expect(messages[0].senderName).toBe("Bob")
    expect(messages[0].content).toBe("hey from Bob")
  })

  it("creator can send a message and it appears in the list", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.run(async (ctx) => seedSession(ctx, userId))

    await t.withIdentity({ subject: userId }).mutation(api.backstageChat.sendBackstageMessage, {
      sessionId,
      content: "hello backstage",
    })

    const messages = await t.withIdentity({ subject: userId }).query(api.backstageChat.listBackstageMessages, {
      sessionId,
    })

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe("hello backstage")
    expect(messages[0].senderType).toBe("creator")
    expect(messages[0].senderName).toBe("alice")
  })
})
