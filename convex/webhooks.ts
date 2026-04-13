// RealtimeKit webhook handler — verifies HMAC-SHA256 signature and routes
// events to tear-down actions. Subscribed event names per RealtimeKit docs:
//   - meeting.ended
//   - livestreaming.statusUpdate
//
// Subscription endpoint (discovered during implementation): The webhook URL
// format is https://api.cloudflare.com/client/v4/accounts/{accountId}/realtime/kit/{appId}/webhooks
// Register the deployment URL https://<deployment>.convex.site/webhooks/rtk via the
// RealtimeKit dashboard Developer section → Webhooks.

import { httpAction } from "./_generated/server"
import { internal } from "./_generated/api"

export async function verifyRtkSignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  const computedHex = Array.from(new Uint8Array(computed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  if (computedHex.length !== signatureHex.length) return false
  let diff = 0
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ signatureHex.charCodeAt(i)
  }
  return diff === 0
}

export const rtkWebhook = httpAction(async (ctx, req) => {
  const secret = process.env.REALTIMEKIT_WEBHOOK_SECRET
  if (!secret) return new Response("webhook secret not configured", { status: 500 })

  const sig =
    req.headers.get("x-webhook-signature") ??
    req.headers.get("webhook-signature") ??
    ""
  const rawBody = await req.text()
  if (!(await verifyRtkSignature(rawBody, sig, secret))) {
    return new Response("bad signature", { status: 401 })
  }

  const payload = JSON.parse(rawBody) as {
    event: string
    meeting?: { id: string }
    livestream?: { status: string }
  }
  console.log("rtkWebhook", payload.event)

  if (payload.event === "meeting.ended" && payload.meeting?.id) {
    await ctx.runAction(internal.streams.teardownByRtkMeeting, {
      cloudflareRoomId: payload.meeting.id,
    })
  }

  if (
    payload.event === "livestreaming.statusUpdate" &&
    payload.meeting?.id &&
    payload.livestream?.status === "OFFLINE"
  ) {
    await ctx.runAction(internal.streams.markSimulcastDegradedByRtkMeeting, {
      cloudflareRoomId: payload.meeting.id,
    })
  }

  return new Response("ok", { status: 200 })
})
