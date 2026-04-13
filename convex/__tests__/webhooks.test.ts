import { describe, expect, test } from "vitest"
import { verifyRtkSignature } from "../webhooks"

async function computeHmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

describe("verifyRtkSignature", () => {
  test("accepts a valid signature", async () => {
    const body = JSON.stringify({ event: "meeting.ended", meeting: { id: "m1" } })
    const sig = await computeHmac("secret", body)
    expect(await verifyRtkSignature(body, sig, "secret")).toBe(true)
  })

  test("rejects a tampered body", async () => {
    const body = JSON.stringify({ event: "meeting.ended", meeting: { id: "m1" } })
    const sig = await computeHmac("secret", body)
    const tampered = JSON.stringify({ event: "meeting.ended", meeting: { id: "EVIL" } })
    expect(await verifyRtkSignature(tampered, sig, "secret")).toBe(false)
  })
})
