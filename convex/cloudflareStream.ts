"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { encrypt, decrypt } from "./lib/tokenEncryption"
import { createLiveInput, addLiveOutput, deleteLiveOutput, getLiveInput } from "../lib/cloudflare-stream"

function summarizeUrl(value: string): Record<string, unknown> {
  try {
    const url = new URL(value)
    return {
      protocol: url.protocol,
      host: url.host,
      pathSegments: url.pathname.split("/").filter(Boolean).length,
      length: value.length,
      parseable: true,
    }
  } catch {
    return {
      startsWithRtmp: value.startsWith("rtmp://") || value.startsWith("rtmps://"),
      length: value.length,
      parseable: false,
    }
  }
}

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
      console.info("[cloudflare-stream] reusing live input", {
        userId,
        liveInputUid: existing.cloudflareLiveInputUid,
        ingestUrl: summarizeUrl(existing.rtmpsUrl),
      })
      return {
        liveInputUid: existing.cloudflareLiveInputUid,
        rtmpsUrl: existing.rtmpsUrl,
        streamKey: decrypt(existing.streamKeyEncrypted),
      }
    }
    console.info("[cloudflare-stream] creating live input", {
      userId,
      displayName,
    })
    const created = await createLiveInput({
      meta: { name: `switched-${displayName}-${userId}` },
    })
    await ctx.runMutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: created.uid,
      rtmpsUrl: created.rtmpsUrl,
      streamKeyEncrypted: encrypt(created.streamKey),
    })
    console.info("[cloudflare-stream] created live input", {
      userId,
      liveInputUid: created.uid,
      ingestUrl: summarizeUrl(created.rtmpsUrl),
      streamKeyLength: created.streamKey.length,
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
    console.info("[cloudflare-stream] creating live output", {
      liveInputUid: args.liveInputUid,
      destination: summarizeUrl(args.destinationUrl),
      streamKeyLength: args.destinationStreamKey.length,
    })
    const result = await addLiveOutput({
      liveInputUid: args.liveInputUid,
      url: args.destinationUrl,
      streamKey: args.destinationStreamKey,
    })
    console.info("[cloudflare-stream] created live output", {
      liveInputUid: args.liveInputUid,
      outputUid: result.uid,
    })
    return { outputUid: result.uid }
  },
})

export const inspectLiveInput = internalAction({
  args: { liveInputUid: v.string() },
  handler: async (_ctx, { liveInputUid }): Promise<{ status: unknown }> => {
    const liveInput = await getLiveInput(liveInputUid)
    const status = liveInput?.status ?? null
    console.info("[cloudflare-stream] live input inspected", {
      liveInputUid,
      status,
    })
    return { status }
  },
})

export const removeSimulcastOutput = internalAction({
  args: { liveInputUid: v.string(), outputUid: v.string() },
  handler: async (_ctx, { liveInputUid, outputUid }): Promise<void> => {
    await deleteLiveOutput({ liveInputUid, outputUid })
  },
})
