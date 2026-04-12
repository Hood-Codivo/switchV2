"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"

function rtkBaseUrl() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
  if (!accountId || !appId) throw new Error("RealtimeKit env not configured")
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
}

function rtkHeaders() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN missing")
  return { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }
}

export const startRtmpRecording = internalAction({
  args: { meetingId: v.string(), rtmpUrlWithKey: v.string() },
  handler: async (_ctx, { meetingId, rtmpUrlWithKey }): Promise<{ recordingId: string }> => {
    const res = await fetch(`${rtkBaseUrl()}/recordings`, {
      method: "POST",
      headers: rtkHeaders(),
      body: JSON.stringify({
        meeting_id: meetingId,
        rtmp_out_config: { rtmp_url: rtmpUrlWithKey },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`rtk.startRtmpRecording failed: ${res.status} — ${body}`)
    }
    const json = (await res.json()) as Record<string, Record<string, unknown>>
    const payload = json.data ?? json.result
    const id = payload?.id as string | undefined
    if (!id) throw new Error(`rtk.startRtmpRecording: no id in ${JSON.stringify(json)}`)
    return { recordingId: id }
  },
})

export const stopRecording = internalAction({
  args: { recordingId: v.string() },
  handler: async (_ctx, { recordingId }): Promise<void> => {
    // Stop verb confirmed by Task 0: PUT /recordings/:id with body {"action":"stop"}
    // A 400 "not in progress" is benign — the recording has already stopped.
    const res = await fetch(`${rtkBaseUrl()}/recordings/${recordingId}`, {
      method: "PUT",
      headers: rtkHeaders(),
      body: JSON.stringify({ action: "stop" }),
    })
    if (res.status === 400) {
      const body = await res.text()
      // "not in progress" (or similar) means the recording already stopped — benign
      if (body.toLowerCase().includes("not in progress") || body.toLowerCase().includes("not_in_progress")) {
        return
      }
      throw new Error(`rtk.stopRecording failed: ${res.status} — ${body}`)
    }
    if (res.status === 404) return // already gone
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`rtk.stopRecording failed: ${res.status} — ${body}`)
    }
  },
})
