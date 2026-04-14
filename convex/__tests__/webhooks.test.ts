import { beforeEach, describe, expect, test, vi } from "vitest"
import { _resetKeyCacheForTesting, verifyRtkSignature } from "../webhooks"

async function generateRsaKeypair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )
}

async function exportPublicKeyAsPem(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)))
  // Wrap at 64 chars per line to match PEM convention.
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`
}

async function signPayload(privateKey: CryptoKey, body: string): Promise<string> {
  const bodyBytes = new TextEncoder().encode(body)
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, bodyBytes)
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
}

function stubFetchWithPublicKey(pem: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { publicKey: pem }, message: "" }),
    }),
  )
}

describe("verifyRtkSignature", () => {
  beforeEach(() => {
    _resetKeyCacheForTesting()
    vi.unstubAllGlobals()
  })

  test("accepts a valid RSA-SHA256 signature", async () => {
    const keypair = await generateRsaKeypair()
    const pem = await exportPublicKeyAsPem(keypair.publicKey)
    stubFetchWithPublicKey(pem)

    const body = JSON.stringify({ event: "meeting.ended", meeting: { id: "m1" } })
    const sigB64 = await signPayload(keypair.privateKey, body)

    expect(await verifyRtkSignature(body, sigB64)).toBe(true)
  })

  test("rejects a tampered body", async () => {
    const keypair = await generateRsaKeypair()
    const pem = await exportPublicKeyAsPem(keypair.publicKey)
    stubFetchWithPublicKey(pem)

    const body = JSON.stringify({ event: "meeting.ended", meeting: { id: "m1" } })
    const sigB64 = await signPayload(keypair.privateKey, body)

    const tampered = JSON.stringify({ event: "meeting.ended", meeting: { id: "EVIL" } })
    expect(await verifyRtkSignature(tampered, sigB64)).toBe(false)
  })
})
