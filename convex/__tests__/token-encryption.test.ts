import { describe, it, expect, beforeEach, vi } from "vitest"
import { encrypt, decrypt, signState, verifyState } from "../lib/tokenEncryption"

// Set a test encryption key (32 bytes = 64 hex chars)
const TEST_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"

describe("token-encryption", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY)
  })

  it("encrypts and decrypts a token round-trip", () => {
    const plaintext = "ya29.a0AfH6SMBx-test-access-token"
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it("produces different ciphertext for the same input (random IV)", () => {
    const plaintext = "ya29.a0AfH6SMBx-test-access-token"
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("some-token")
    // Flip a character in the middle of the ciphertext
    const tampered =
      encrypted.slice(0, Math.floor(encrypted.length / 2)) +
      "X" +
      encrypted.slice(Math.floor(encrypted.length / 2) + 1)
    expect(() => decrypt(tampered)).toThrow()
  })

  it("throws if TOKEN_ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "")
    expect(() => encrypt("token")).toThrow("TOKEN_ENCRYPTION_KEY")
  })
})

describe("state signing", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY)
  })

  it("signs and verifies a state payload", () => {
    const payload = "did:privy:abc123:1712345678"
    const sig = signState(payload)
    expect(verifyState(payload, sig)).toBe(true)
  })

  it("rejects a tampered payload", () => {
    const payload = "did:privy:abc123:1712345678"
    const sig = signState(payload)
    expect(verifyState("did:privy:evil:1712345678", sig)).toBe(false)
  })

  it("rejects a tampered signature", () => {
    const payload = "did:privy:abc123:1712345678"
    const sig = signState(payload)
    expect(verifyState(payload, sig.replace(sig[0], "0"))).toBe(false)
  })
})
