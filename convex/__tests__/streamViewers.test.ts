import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api, internal } from "../_generated/api"
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

async function seedStream(ctx: GenericMutationCtx<DataModel>, creatorId: Id<"users">) {
  return ctx.db.insert("streams", {
    creatorId,
    username: "alice",
    title: "Test Stream",
    category: "Gaming",
    status: "live",
    viewerCount: 0,
    peakViewerCount: 0,
  })
}

// ─── streamViewers.join ───────────────────────────────────────────────────────

describe("streamViewers.join", () => {
  it("increments viewer count when a new tab joins", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "session-1" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "session-2" })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.viewerCount).toBe(2)
  })

  it("is idempotent — rejoining the same session does not double-count", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "session-1" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "session-1" })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.viewerCount).toBe(1)
  })

  it("tracks peakViewerCount correctly", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "s1" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "s2" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "s3" })
    await t.mutation(api.streamViewers.leave, { sessionId: "s3" })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.viewerCount).toBe(2)
    expect(stream?.peakViewerCount).toBe(3)
  })
})

// ─── streamViewers.heartbeat ──────────────────────────────────────────────────

describe("streamViewers.heartbeat", () => {
  it("refreshes lastSeen for an existing presence record", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "session-1" })

    // Manually age the record to simulate time passing
    await t.run(async (ctx) => {
      const record = await ctx.db
        .query("streamViewers")
        .withIndex("by_session", (q) => q.eq("sessionId", "session-1"))
        .first()
      if (record) await ctx.db.patch(record._id, { lastSeen: Date.now() - 60_000 })
    })

    const beforeHeartbeat = Date.now()
    await t.mutation(api.streamViewers.heartbeat, { sessionId: "session-1" })

    const record = await t.run(async (ctx) =>
      ctx.db
        .query("streamViewers")
        .withIndex("by_session", (q) => q.eq("sessionId", "session-1"))
        .first(),
    )
    expect(record?.lastSeen).toBeGreaterThanOrEqual(beforeHeartbeat)
  })

  it("is a no-op when the session is not found", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.streamViewers.heartbeat, { sessionId: "ghost-session" }),
    ).resolves.not.toThrow()
  })
})

// ─── streamViewers.leave ──────────────────────────────────────────────────────

describe("streamViewers.leave", () => {
  it("decrements viewer count when a tab leaves", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "s1" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "s2" })
    await t.mutation(api.streamViewers.leave, { sessionId: "s1" })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.viewerCount).toBe(1)
  })

  it("is a no-op when the session is not found", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.streamViewers.leave, { sessionId: "ghost-session" }),
    ).resolves.not.toThrow()
  })
})

// ─── stale presence pruning ───────────────────────────────────────────────────

describe("stale presence — viewer count accuracy", () => {
  it("excludes stale viewers from the count without needing to delete them first", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "stale" })
    await t.run(async (ctx) => {
      const record = await ctx.db
        .query("streamViewers")
        .withIndex("by_session", (q) => q.eq("sessionId", "stale"))
        .first()
      if (record) await ctx.db.patch(record._id, { lastSeen: Date.now() - 120_000 })
    })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "fresh" })

    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    // Stale session is excluded from count; only "fresh" is counted
    expect(stream?.viewerCount).toBe(1)

    // The stale row still exists — physical cleanup is the scheduled job's job
    const staleRecord = await t.run(async (ctx) =>
      ctx.db
        .query("streamViewers")
        .withIndex("by_session", (q) => q.eq("sessionId", "stale"))
        .first(),
    )
    expect(staleRecord).not.toBeNull()
  })
})

// ─── pruneStaleViewers (scheduled job) ───────────────────────────────────────

describe("pruneStaleViewers", () => {
  it("deletes all stale presence records and recounts affected streams", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const streamId = await t.run(async (ctx) => seedStream(ctx, userId))

    await t.mutation(api.streamViewers.join, { streamId, sessionId: "stale-1" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "stale-2" })
    await t.mutation(api.streamViewers.join, { streamId, sessionId: "fresh" })

    // Age the two stale records
    await t.run(async (ctx) => {
      for (const sessionId of ["stale-1", "stale-2"]) {
        const record = await ctx.db
          .query("streamViewers")
          .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
          .first()
        if (record) await ctx.db.patch(record._id, { lastSeen: Date.now() - 120_000 })
      }
    })

    await t.mutation(internal.streamViewers.pruneStaleViewers, {})

    // Stale rows physically gone
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("streamViewers").withIndex("by_stream", (q) => q.eq("streamId", streamId)).collect(),
    )
    expect(remaining).toHaveLength(1)
    expect(remaining[0].sessionId).toBe("fresh")

    // Stream viewer count reflects actual live viewers
    const stream = await t.run(async (ctx) => ctx.db.get(streamId))
    expect(stream?.viewerCount).toBe(1)
  })

  it("handles multiple streams in a single sweep", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const stream1Id = await t.run(async (ctx) => seedStream(ctx, userId))
    const stream2Id = await t.run(async (ctx) =>
      ctx.db.insert("streams", {
        creatorId: userId,
        username: "alice",
        title: "Stream 2",
        category: "Music",
        status: "live",
        viewerCount: 0,
        peakViewerCount: 0,
      }),
    )

    await t.mutation(api.streamViewers.join, { streamId: stream1Id, sessionId: "s1-stale" })
    await t.mutation(api.streamViewers.join, { streamId: stream2Id, sessionId: "s2-stale" })

    await t.run(async (ctx) => {
      const all = await ctx.db.query("streamViewers").collect()
      for (const r of all) await ctx.db.patch(r._id, { lastSeen: Date.now() - 120_000 })
    })

    await t.mutation(internal.streamViewers.pruneStaleViewers, {})

    const s1 = await t.run(async (ctx) => ctx.db.get(stream1Id))
    const s2 = await t.run(async (ctx) => ctx.db.get(stream2Id))
    expect(s1?.viewerCount).toBe(0)
    expect(s2?.viewerCount).toBe(0)
  })
})
