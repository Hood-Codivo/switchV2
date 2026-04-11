import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "crypto"

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)")
  }
  return Buffer.from(hex, "hex")
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns a base64 string: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, authTag]).toString("base64")
}

/**
 * Decrypts a base64 string produced by `encrypt()`.
 */
export function decrypt(encrypted: string): string {
  const key = getKey()
  const buf = Buffer.from(encrypted, "base64")
  const iv = buf.subarray(0, 12)
  const authTag = buf.subarray(buf.length - 16)
  const ciphertext = buf.subarray(12, buf.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext) + decipher.final("utf8")
}

/**
 * Creates an HMAC-SHA256 signature for OAuth state parameters.
 */
export function signState(payload: string): string {
  const key = getKey()
  return createHmac("sha256", key).update(payload).digest("hex")
}

/**
 * Verifies an HMAC-SHA256 signature for OAuth state parameters.
 */
export function verifyState(payload: string, signature: string): boolean {
  const expected = signState(payload)
  if (expected.length !== signature.length) return false
  // Constant-time comparison
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}
