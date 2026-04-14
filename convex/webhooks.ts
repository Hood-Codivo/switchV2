// RealtimeKit webhook handler — verifies RSA-SHA256 signature and routes
// events to tear-down actions. Subscribed event names per RealtimeKit docs:
//   - meeting.ended
//   - livestreaming.statusUpdate
//
// Subscription endpoint (discovered during implementation): The webhook URL
// format is https://api.cloudflare.com/client/v4/accounts/{accountId}/realtime/kit/{appId}/webhooks
// Register the deployment URL https://<deployment>.convex.site/webhooks/rtk via the
// RealtimeKit dashboard Developer section → Webhooks.
//
// RealtimeKit signs webhooks with RSA-SHA256 (RSASSA-PKCS1-v1_5).
// The public key is fetched from the well-known endpoint and cached at module scope.
// No shared secret is used — signature header name is "dyte-signature".

import { httpAction } from "./_generated/server"
import { internal } from "./_generated/api"

const PUBLIC_KEY_URL = "https://api.realtime.cloudflare.com/.well-known/webhooks.json"

// Module-level cache — survives across requests in the same V8 isolate.
let cachedKey: CryptoKey | null = null

async function getRtkPublicKey(): Promise<CryptoKey> {
  if (cachedKey !== null) return cachedKey

  const res = await fetch(PUBLIC_KEY_URL)
  if (!res.ok) throw new Error(`Failed to fetch RTK public key: ${res.status}`)
  const json = (await res.json()) as { success: boolean; data: { publicKey: string }; message: string }
  if (!json.success) throw new Error("RTK public key endpoint returned success=false")

  const pem: string = json.data.publicKey
  // Strip PEM header/footer and all whitespace (including \n, \r) to get bare base64.
  const b64 = pem.replace(/-----BEGIN[^-]+-----|-----END[^-]+-----|\s/g, "")
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

  cachedKey = await crypto.subtle.importKey(
    "spki",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  )
  return cachedKey
}

export function _resetKeyCacheForTesting(): void {
  cachedKey = null
}

export async function verifyRtkSignature(rawBody: string, signatureB64: string): Promise<boolean> {
  const key = await getRtkPublicKey()
  const signatureBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0))
  const bodyBytes = new TextEncoder().encode(rawBody)
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signatureBytes, bodyBytes)
}

export const rtkWebhook = httpAction(async (ctx, req) => {
  const sig = req.headers.get("dyte-signature") ?? ""
  const rawBody = await req.text()

  let verified: boolean
  try {
    verified = await verifyRtkSignature(rawBody, sig)
  } catch (err) {
    console.error("rtkWebhook signature verification error", err)
    return new Response("signature verification failed", { status: 500 })
  }

  if (!verified) {
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
