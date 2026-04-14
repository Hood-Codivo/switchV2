import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"
import { internal } from "../_generated/api"

describe("creatorLiveInputs", () => {
  test("getForUser returns null when none exists", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "x", walletAddress: "w" }),
    )
    const result = await t.query(internal.creatorLiveInputs.getForUser, { userId })
    expect(result).toBeNull()
  })

  test("upsertForUser inserts, then overwrites on second call", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "x", walletAddress: "w" }),
    )
    await t.mutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: "cf-1",
      rtmpsUrl: "rtmps://a",
      streamKeyEncrypted: "e1",
    })
    expect(
      (await t.query(internal.creatorLiveInputs.getForUser, { userId }))
        ?.cloudflareLiveInputUid,
    ).toBe("cf-1")

    await t.mutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: "cf-2",
      rtmpsUrl: "rtmps://b",
      streamKeyEncrypted: "e2",
    })
    expect(
      (await t.query(internal.creatorLiveInputs.getForUser, { userId }))
        ?.cloudflareLiveInputUid,
    ).toBe("cf-2")
  })
})
