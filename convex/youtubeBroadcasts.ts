"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { decrypt } from "./lib/tokenEncryption"

type Privacy = "public" | "unlisted" | "private"

export type YoutubeErrorCode =
  | "quota_exceeded"
  | "invalid_credentials"
  | "not_found"
  | "unknown"

export function parseYoutubeError(body: unknown): YoutubeErrorCode {
  const err = (body as { error?: { code?: number; errors?: Array<{ reason?: string }> } })?.error
  if (!err) return "unknown"
  const reasons = err.errors?.map((e) => e.reason) ?? []
  if (reasons.includes("quotaExceeded")) return "quota_exceeded"
  if (reasons.includes("authError") || err.code === 401) return "invalid_credentials"
  if (err.code === 404) return "not_found"
  return "unknown"
}

export function buildYoutubeInsertBroadcastBody(args: {
  title: string
  description: string
  privacy: Privacy
  scheduledStartTime: string
}) {
  return {
    snippet: {
      title: args.title,
      description: args.description,
      scheduledStartTime: args.scheduledStartTime,
    },
    status: {
      privacyStatus: args.privacy,
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      enableAutoStart: true,
      enableAutoStop: true,
      enableDvr: true,
    },
  }
}

async function authedFetch(accessToken: string, url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

export const createBroadcast = internalAction({
  args: {
    connectionId: v.id("connectedPlatforms"),
    title: v.string(),
    description: v.string(),
    privacy: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    broadcastId: string
    streamId: string
    rtmpUrl: string
    streamKey: string
  }> => {
    await ctx.runAction(api.connectedPlatformsActions.refreshYoutubeToken, {
      connectionId: args.connectionId,
    })
    const conn = await ctx.runQuery(internal.connectedPlatforms.getRawConnection, {
      connectionId: args.connectionId,
    })
    if (!conn?.accessToken) throw new Error("YouTube connection missing access token")
    const accessToken = decrypt(conn.accessToken)

    // 1. liveBroadcasts.insert
    const broadcastRes = await authedFetch(
      accessToken,
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
      {
        method: "POST",
        body: JSON.stringify(
          buildYoutubeInsertBroadcastBody({
            title: args.title,
            description: args.description,
            privacy: args.privacy,
            scheduledStartTime: new Date().toISOString(),
          }),
        ),
      },
    )
    if (!broadcastRes.ok) {
      const bodyText = await broadcastRes.text().catch(() => "")
      let parsed: unknown = {}
      try { parsed = JSON.parse(bodyText) } catch { /* non-JSON body */ }
      console.error("youtube.createBroadcast failed", broadcastRes.status, bodyText)
      throw new Error(
        `youtube.createBroadcast:${parseYoutubeError(parsed)}:${broadcastRes.status} — ${bodyText.slice(0, 500)}`,
      )
    }
    const broadcast = (await broadcastRes.json()) as { id: string }

    // 2. liveStreams.insert
    const streamRes = await authedFetch(
      accessToken,
      "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,status",
      {
        method: "POST",
        body: JSON.stringify({
          snippet: { title: args.title },
          cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
        }),
      },
    )
    if (!streamRes.ok) {
      const bodyText = await streamRes.text().catch(() => "")
      let parsed: unknown = {}
      try { parsed = JSON.parse(bodyText) } catch { /* non-JSON body */ }
      console.error("youtube.createStream failed", streamRes.status, bodyText)
      throw new Error(
        `youtube.createStream:${parseYoutubeError(parsed)}:${streamRes.status} — ${bodyText.slice(0, 500)}`,
      )
    }
    const stream = (await streamRes.json()) as {
      id: string
      cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } }
    }

    // 3. liveBroadcasts.bind
    const bindRes = await authedFetch(
      accessToken,
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?part=id,contentDetails&id=${broadcast.id}&streamId=${stream.id}`,
      { method: "POST" },
    )
    if (!bindRes.ok) {
      const bodyText = await bindRes.text().catch(() => "")
      let parsed: unknown = {}
      try { parsed = JSON.parse(bodyText) } catch { /* non-JSON body */ }
      console.error("youtube.bind failed", bindRes.status, bodyText)
      throw new Error(
        `youtube.bind:${parseYoutubeError(parsed)}:${bindRes.status} — ${bodyText.slice(0, 500)}`,
      )
    }

    return {
      broadcastId: broadcast.id,
      streamId: stream.id,
      rtmpUrl: stream.cdn.ingestionInfo.ingestionAddress,
      streamKey: stream.cdn.ingestionInfo.streamName,
    }
  },
})

export const transitionBroadcast = internalAction({
  args: {
    connectionId: v.id("connectedPlatforms"),
    broadcastId: v.string(),
    status: v.union(v.literal("live"), v.literal("complete")),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runAction(api.connectedPlatformsActions.refreshYoutubeToken, {
      connectionId: args.connectionId,
    })
    const conn = await ctx.runQuery(internal.connectedPlatforms.getRawConnection, {
      connectionId: args.connectionId,
    })
    if (!conn?.accessToken) throw new Error("YouTube connection missing access token")
    const accessToken = decrypt(conn.accessToken)

    const url = `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=${args.status}&id=${args.broadcastId}&part=id,status`
    const res = await authedFetch(accessToken, url, { method: "POST" })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as unknown
      throw new Error(`youtube.transition:${parseYoutubeError(body)}:${res.status}`)
    }
  },
})

export const deleteBroadcast = internalAction({
  args: { connectionId: v.id("connectedPlatforms"), broadcastId: v.string() },
  handler: async (ctx, { connectionId, broadcastId }): Promise<void> => {
    try {
      await ctx.runAction(api.connectedPlatformsActions.refreshYoutubeToken, { connectionId })
    } catch {
      return
    }
    const conn = await ctx.runQuery(internal.connectedPlatforms.getRawConnection, { connectionId })
    if (!conn?.accessToken) return
    const accessToken = decrypt(conn.accessToken)
    await authedFetch(
      accessToken,
      `https://www.googleapis.com/youtube/v3/liveBroadcasts?id=${broadcastId}`,
      { method: "DELETE" },
    ).catch(() => {})
  },
})
