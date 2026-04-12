import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"
import { internal } from "../_generated/api"

const modules = import.meta.glob("../**/*.ts")

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { privyDid: "x", walletAddress: "w" })
    const streamId = await ctx.db.insert("streams", {
      creatorId: userId, username: "u", title: "t", category: "Other",
      status: "live", viewerCount: 0, peakViewerCount: 0,
    })
    return { userId, streamId }
  })
}

describe("streamBroadcasts", () => {
  test("create → attachExternals → markLive → markEnded", async () => {
    const t = convexTest(schema, modules)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })
    await t.mutation(internal.streamBroadcasts.attachExternals, {
      id, externalBroadcastId: "yt-b", externalStreamId: "yt-s", rtkRecordingId: "rec-1",
    })
    await t.mutation(internal.streamBroadcasts.markLive, { id })
    await t.mutation(internal.streamBroadcasts.markEnded, { id })
    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("ended")
    expect(record?.endedAt).toBeDefined()
    expect(record?.rtkRecordingId).toBe("rec-1")
  })

  test("markDegraded sets degradedSince", async () => {
    const t = convexTest(schema, modules)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })
    await t.mutation(internal.streamBroadcasts.markDegraded, { id })
    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("degraded")
    expect(record?.degradedSince).toBeTypeOf("number")
  })

  test("markFailed sets errorMessage", async () => {
    const t = convexTest(schema, modules)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })
    await t.mutation(internal.streamBroadcasts.markFailed, { id, errorMessage: "nope" })
    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("failed")
    expect(record?.errorMessage).toBe("nope")
  })
})
