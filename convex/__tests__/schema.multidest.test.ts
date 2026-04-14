// convex/__tests__/schema.multidest.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"

describe("multi-destination schema", () => {
  test("can insert a creatorLiveInput record", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:1", walletAddress: "w1" })
      return ctx.db.insert("creatorLiveInputs", {
        userId,
        cloudflareLiveInputUid: "li-1",
        rtmpsUrl: "rtmps://live.cloudflare.com:443/live/",
        streamKeyEncrypted: "enc",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })

  test("streamBroadcasts can carry cloudflareLiveOutputUid", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:2", walletAddress: "w2" })
      const streamId = await ctx.db.insert("streams", {
        creatorId: userId, username: "u", title: "t", category: "Other",
        status: "live", viewerCount: 0, peakViewerCount: 0,
      })
      return ctx.db.insert("streamBroadcasts", {
        streamId,
        platform: "youtube",
        status: "pending",
        cloudflareLiveOutputUid: "lo-1",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })
})
