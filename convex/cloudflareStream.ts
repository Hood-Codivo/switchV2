"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { encrypt, decrypt } from "./lib/tokenEncryption"
import { createLiveInput, addLiveOutput, deleteLiveOutput } from "../lib/cloudflare-stream"

export const ensureLiveInput = internalAction({
  args: { userId: v.id("users"), displayName: v.string() },
  handler: async (
    ctx,
    { userId, displayName },
  ): Promise<{
    liveInputUid: string
    rtmpsUrl: string
    streamKey: string
  }> => {
    const existing = await ctx.runQuery(internal.creatorLiveInputs.getForUser, { userId })
    if (existing) {
      return {
        liveInputUid: existing.cloudflareLiveInputUid,
        rtmpsUrl: existing.rtmpsUrl,
        streamKey: decrypt(existing.streamKeyEncrypted),
      }
    }
    const created = await createLiveInput({
      meta: { name: `switched-${displayName}-${userId}` },
    })
    await ctx.runMutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: created.uid,
      rtmpsUrl: created.rtmpsUrl,
      streamKeyEncrypted: encrypt(created.streamKey),
    })
    return {
      liveInputUid: created.uid,
      rtmpsUrl: created.rtmpsUrl,
      streamKey: created.streamKey,
    }
  },
})

export const createSimulcastOutput = internalAction({
  args: {
    liveInputUid: v.string(),
    destinationUrl: v.string(),
    destinationStreamKey: v.string(),
  },
  handler: async (_ctx, args): Promise<{ outputUid: string }> => {
    const result = await addLiveOutput({
      liveInputUid: args.liveInputUid,
      url: args.destinationUrl,
      streamKey: args.destinationStreamKey,
    })
    return { outputUid: result.uid }
  },
})

export const removeSimulcastOutput = internalAction({
  args: { liveInputUid: v.string(), outputUid: v.string() },
  handler: async (_ctx, { liveInputUid, outputUid }): Promise<void> => {
    await deleteLiveOutput({ liveInputUid, outputUid })
  },
})
