import { describe, expect, it } from "vitest"
import { validateUsername } from "../lib/username"

describe("validateUsername", () => {
  it("rejects an empty string", () => {
    const result = validateUsername("")
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toBeDefined()
  })

  it("rejects usernames shorter than 3 characters", () => {
    expect(validateUsername("ab").valid).toBe(false)
    expect(validateUsername("a").valid).toBe(false)
  })

  it("rejects usernames longer than 30 characters", () => {
    expect(validateUsername("a".repeat(31)).valid).toBe(false)
  })

  it("rejects usernames with spaces", () => {
    expect(validateUsername("hello world").valid).toBe(false)
  })

  it("rejects usernames with special characters other than - and _", () => {
    expect(validateUsername("hello@world").valid).toBe(false)
    expect(validateUsername("user.name").valid).toBe(false)
    expect(validateUsername("user!name").valid).toBe(false)
  })

  it("accepts a valid username with letters and numbers", () => {
    expect(validateUsername("alice123").valid).toBe(true)
  })

  it("accepts a valid username with hyphens and underscores", () => {
    expect(validateUsername("alice_123-xyz").valid).toBe(true)
  })

  it("accepts a username at exactly 3 characters", () => {
    expect(validateUsername("abc").valid).toBe(true)
  })

  it("accepts a username at exactly 30 characters", () => {
    expect(validateUsername("a".repeat(30)).valid).toBe(true)
  })
})
