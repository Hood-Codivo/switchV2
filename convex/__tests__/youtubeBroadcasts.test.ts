import { describe, expect, test } from "vitest"
import { buildYoutubeInsertBroadcastBody, parseYoutubeError } from "../youtubeBroadcasts"

describe("youtubeBroadcasts helpers", () => {
  test("buildYoutubeInsertBroadcastBody shapes the request body", () => {
    const body = buildYoutubeInsertBroadcastBody({
      title: "Hello",
      description: "desc",
      privacy: "public",
      scheduledStartTime: "2026-04-13T00:00:00Z",
    })
    expect(body.snippet.title).toBe("Hello")
    expect(body.status.privacyStatus).toBe("public")
    expect(body.snippet.scheduledStartTime).toBe("2026-04-13T00:00:00Z")
  })

  test("parseYoutubeError extracts quota-exceeded", () => {
    expect(
      parseYoutubeError({
        error: { code: 403, errors: [{ reason: "quotaExceeded" }] },
      }),
    ).toBe("quota_exceeded")
  })

  test("parseYoutubeError extracts invalid-credentials", () => {
    expect(
      parseYoutubeError({
        error: { code: 401, errors: [{ reason: "authError" }] },
      }),
    ).toBe("invalid_credentials")
  })

  test("parseYoutubeError returns unknown for weird shapes", () => {
    expect(parseYoutubeError({ weird: true })).toBe("unknown")
  })
})
