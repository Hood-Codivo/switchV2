// convex/__tests__/schema.simulcast.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

describe("simulcast schema", () => {
  test("can insert a streamBroadcast record", async () => {
    const t = convexTest(schema, modules)
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:1", walletAddress: "w1" })
      const streamId = await ctx.db.insert("streams", {
        creatorId: userId, username: "u", title: "t", category: "Other",
        status: "live", viewerCount: 0, peakViewerCount: 0,
      })
      return ctx.db.insert("streamBroadcasts", {
        streamId,
        platform: "youtube",
        status: "pending",
        externalBroadcastId: "yt-b-1",
        externalStreamId: "yt-s-1",
        rtkRecordingId: "rec-1",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })

  test("streams can carry simulcastEnabled flag", async () => {
    const t = convexTest(schema, modules)
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:2", walletAddress: "w2" })
      return ctx.db.insert("streams", {
        creatorId: userId, username: "u", title: "t", category: "Other",
        status: "live", viewerCount: 0, peakViewerCount: 0,
        simulcastEnabled: true,
      })
    })
    expect(id).toBeDefined()
  })
})
