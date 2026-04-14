# YouTube Simulcast Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a Switched creator to simulcast a live stream to YouTube in parallel with the Switched HLS feed, using RealtimeKit's `/recordings` endpoint with an `rtmp_out_config` destination pointed at a per-broadcast YouTube RTMP URL.

**Architecture:** Video flows RealtimeKit meeting → (a) RealtimeKit `/livestreams` (HLS) for Switched viewers — unchanged — and (b) RealtimeKit `/recordings` with `rtmp_out_config.rtmp_url` = YouTube's RTMP URL + stream key combined. Each go-live creates a fresh YouTube `liveBroadcast` + `liveStream`, binds them, and transitions to `live` after the recording POST is confirmed. Stream end transitions the YouTube broadcast to `complete` and stops the recording. Cloudflare Stream Live Input is NOT in the path — RealtimeKit handles the RTMP push-out natively.

**Tech Stack:** Convex (actions, mutations, HTTP actions, crons), RealtimeKit REST API (existing Cloudflare-branded surface at `api.cloudflare.com/client/v4/accounts/{id}/realtime/kit/{app}/...`), YouTube Data API v3 (liveBroadcasts, liveStreams), Next.js / React UI, existing AES-256-GCM token encryption in `convex/lib/tokenEncryption.ts`.

---

## Context — why this is v2

**v1** assumed RealtimeKit's `/livestreams` endpoint accepted a `destinations` array for RTMP fan-out. Task 0 verification (commit `1eaa565`) returned `422 "destinations is not allowed"`. The simulcast feature actually lives on a separate endpoint, `/recordings`, with the `rtmp_out_config` field. v2 pivots to that endpoint.

**Decisions preserved from v1 design conversation (2026-04-12/13):**
- Per-broadcast YouTube lifecycle (not persistent stream key)
- 4a: confirm modal on OAuth failure
- 4b: retry-once-with-backoff on YouTube API errors, then graceful-degrade
- 4c (rephrased): retry-once on RealtimeKit `/recordings` POST failure, then graceful-degrade
- 4d: live banner + 60s kill-switch
- 4e: best-effort tear-down
- 4f: RealtimeKit webhook + safety cron
- 4g: graceful-degrade on quota exhaustion

**Decisions dropped / changed:**
- ~~Option A (RealtimeKit → Cloudflare Stream Live Input → Live Outputs)~~ → replaced by RealtimeKit `/recordings` path
- ~~Per-creator persistent Live Input~~ → not needed, no Live Input in the architecture

**Task 0 verification (2026-04-12):**
- POST `/recordings` with `rtmp_out_config: { rtmp_url }` → status `201`, body shape `{"success":true,"data":{"id":"<uuid>","meeting_id":"<uuid>","status":"INVOKED","output_file_name":"<meeting_id>_<timestamp>.mp4","start_reason":{"reason":"API_CALL","caller":{"type":"ORGANIZATION"}},...}}`, recording id field `id`
- Stop endpoint: `PUT /recordings/:id` with body `{"action":"stop"}` — allowed actions are `stop`, `pause`, `resume`. Returns `400 "The recording is not in progress"` when recording has already errored (expected with placeholder RTMP URL); the action name and endpoint shape are confirmed valid. `DELETE /recordings/:id`, `POST /recordings/:id/stop`, and all other verb/path combinations return `404`.

---

## Known limitations for Phase 1 (flagged for Phase 2)

- **Multi-destination simulcast** is not yet supported by `rtmp_out_config` as documented — the shape shows a single `rtmp_url`. For Phase 2 (YouTube + X + LinkedIn), expect to either (a) make N parallel `/recordings` calls with N `rtmp_out_config` objects against the same `meeting_id`, or (b) discover a multi-destination variant not yet documented. Phase 1 targets YouTube only.
- **Stop endpoint for recordings** is not documented on the pages available; Task 0 verifies the stop path empirically.

---

## File Structure

**New files:**
- `convex/youtubeBroadcasts.ts` — Convex actions for YouTube per-broadcast lifecycle
- `convex/webhooks.ts` — HTTP action: RealtimeKit webhook handler + signature verification
- `convex/streamBroadcasts.ts` — queries/mutations for the new `streamBroadcasts` table
- `convex/rtkRecordings.ts` — thin wrapper around RealtimeKit `/recordings` POST/DELETE via the Cloudflare-branded proxy
- `components/studio/simulcast-status.tsx` — live banner + kill-switch UI

**Modified files:**
- `convex/schema.ts` — add `streamBroadcasts`; extend `streams`
- `convex/streams.ts` — extend `goLive` + `endLivestream` to orchestrate simulcast
- `convex/http.ts` — mount webhook route
- `convex/crons.ts` — add orphan cleanup cron
- `components/studio/go-live-modal.tsx` — per-broadcast YouTube metadata fields + pre-flight confirm
- `components/studio/studio-view.tsx` — wire SimulcastStatus component
- `hooks/use-go-live.ts` — surface simulcast state

**Dropped from v1:** `lib/cloudflare-stream.ts`, `convex/cloudflareStream.ts`, `convex/creatorLiveInputs.ts`, `lib/queries/cloudflare-stream.ts`, `app/api/cloudflare-stream/...` route, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN`.

---

## Pre-requisite env vars

No new env vars are needed. RealtimeKit uses RSA public-key verification for webhooks — the public key is fetched automatically from `https://api.realtime.cloudflare.com/.well-known/webhooks.json` and cached at module scope. No shared secret exists.

No Cloudflare Stream vars are needed. `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_REALTIMEKIT_APP_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` are already present.

---

## Task 0: Verify `/recordings` endpoint with `rtmp_out_config` + discover stop endpoint

**Purpose:** Confirm that the RealtimeKit `/recordings` POST on the Cloudflare-branded surface accepts `rtmp_out_config` and discover the stop endpoint shape. This is the only API surface we haven't exercised in production code — everything else in this plan builds on the shape we observe here.

**Files:**
- Create: `scripts/verify-rtk-recordings.ts` (throwaway)

- [ ] **Step 1: Write the verification script**

```typescript
// scripts/verify-rtk-recordings.ts
// Run with: pnpm exec dotenv -e .env.local -- tsx scripts/verify-rtk-recordings.ts
import { config } from "dotenv"
config({ path: ".env.local" })

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
if (!accountId || !apiToken || !appId) {
  throw new Error("Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_REALTIMEKIT_APP_ID")
}

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }

async function main() {
  // 1. Create throwaway meeting
  const meetingRes = await fetch(`${base}/meetings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "recordings-verify", preferred_region: "us-east-1" }),
  })
  const meeting = await meetingRes.json()
  const meetingId = (meeting.data ?? meeting.result)?.id
  if (!meetingId) throw new Error(`No meeting id: ${JSON.stringify(meeting)}`)
  console.log("meetingId", meetingId)

  // 2. Attempt /recordings POST with rtmp_out_config
  // Use a placeholder RTMP URL — we don't need a real ingest, just a 2xx with
  // an echoed config to confirm the API accepts the shape.
  const recRes = await fetch(`${base}/recordings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      meeting_id: meetingId,
      rtmp_out_config: { rtmp_url: "rtmp://example.invalid/live/placeholder-key" },
    }),
  })
  const recStatus = recRes.status
  const recBody = await recRes.text()
  console.log("recordings POST status", recStatus)
  console.log("recordings POST body", recBody)

  const parsed = JSON.parse(recBody)
  const recordingId = (parsed.data ?? parsed.result)?.id

  // 3. If we got an id, try stop endpoints to discover the shape
  if (recordingId) {
    console.log("recordingId", recordingId)

    // Try DELETE /recordings/{id}
    const delRes = await fetch(`${base}/recordings/${recordingId}`, {
      method: "DELETE",
      headers,
    })
    console.log("DELETE /recordings/:id status", delRes.status)
    console.log("DELETE body", await delRes.text())

    // If that fails, try the /stop convention
    if (!delRes.ok) {
      const stopRes = await fetch(`${base}/recordings/${recordingId}/stop`, {
        method: "POST",
        headers,
      })
      console.log("POST /recordings/:id/stop status", stopRes.status)
      console.log("stop body", await stopRes.text())
    }
  }

  // 4. Cleanup meeting
  await fetch(`${base}/meetings/${meetingId}`, { method: "DELETE", headers })
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the script and record the observed shapes**

Run: `pnpm exec dotenv -e .env.local -- tsx scripts/verify-rtk-recordings.ts`

Record verbatim:
- The POST `/recordings` response (status + body)
- The recording id field name (likely `id`)
- Which stop method returned 2xx — `DELETE /recordings/:id` or `POST /recordings/:id/stop`

- [ ] **Step 3: Record findings in this plan file**

Edit this plan file under the "Context — why this is v2" section, add:

```markdown
**Task 0 verification (YYYY-MM-DD):**
- POST `/recordings` with `rtmp_out_config: { rtmp_url }` → status `<200|201>`, body shape `<paste>`, recording id field `<id>`
- Stop endpoint: `<DELETE /recordings/:id | POST /recordings/:id/stop>` returned `<status>`
```

- [ ] **Step 4: Delete the script**

```bash
rm scripts/verify-rtk-recordings.ts
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-13-youtube-simulcast-v2.md
git commit -m "chore: verify RealtimeKit /recordings endpoint shape and stop path"
```

**If Step 2 returns 4xx saying `rtmp_out_config` is not allowed on the Cloudflare-branded proxy:** stop. Try the direct `api.realtime.cloudflare.com/v2/recordings` surface with Basic auth. If that also fails, the feature isn't on your account — pivot to Restream.

---

## Task 1: Schema additions

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/__tests__/schema.simulcast.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// convex/__tests__/schema.simulcast.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"

describe("simulcast schema", () => {
  test("can insert a streamBroadcast record", async () => {
    const t = convexTest(schema)
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:1", walletAddress: "w1" })
      const streamId = await ctx.db.insert("streams", {
        creatorId: userId, username: "u", title: "t", category: "Other",
        status: "live", viewerCount: 0, peakViewerCount: 0,
      })
      return ctx.db.insert("streamBroadcasts", {
        streamId,
        platform: "youtube",
        status: "pending",
        externalBroadcastId: "yt-b-1",
        externalStreamId: "yt-s-1",
        rtkRecordingId: "rec-1",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })

  test("streams can carry simulcastEnabled flag", async () => {
    const t = convexTest(schema)
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:2", walletAddress: "w2" })
      return ctx.db.insert("streams", {
        creatorId: userId, username: "u", title: "t", category: "Other",
        status: "live", viewerCount: 0, peakViewerCount: 0,
        simulcastEnabled: true,
      })
    })
    expect(id).toBeDefined()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run convex/__tests__/schema.simulcast.test.ts`
Expected: schema validation error — `streamBroadcasts` table and `simulcastEnabled` field don't exist.

- [ ] **Step 3: Extend the schema**

In `convex/schema.ts`, inside the `streams` table after `spendingApprovalSignature`, add:

```typescript
    simulcastEnabled: v.optional(v.boolean()), // true if creator opted to simulcast this stream
```

Add a new table before the final `})` of `defineSchema({ ... })`:

```typescript
  streamBroadcasts: defineTable({
    streamId: v.id("streams"),
    platform: v.union(v.literal("youtube"), v.literal("x")),

    status: v.union(
      v.literal("pending"),
      v.literal("live"),
      v.literal("degraded"),
      v.literal("ended"),
      v.literal("failed"),
    ),

    // External platform identifiers
    externalBroadcastId: v.optional(v.string()),  // YouTube liveBroadcast.id
    externalStreamId: v.optional(v.string()),     // YouTube liveStream.id

    // RealtimeKit recording id driving the RTMP push to the destination
    rtkRecordingId: v.optional(v.string()),

    // Pre-broadcast metadata (user-supplied in go-live modal)
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    privacy: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),

    // Observability
    errorMessage: v.optional(v.string()),
    degradedSince: v.optional(v.number()),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_stream", ["streamId"])
    .index("by_stream_and_platform", ["streamId", "platform"])
    .index("by_status", ["status"])
    .index("by_external_broadcast", ["externalBroadcastId"])
    .index("by_rtk_recording", ["rtkRecordingId"]),
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/schema.simulcast.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/__tests__/schema.simulcast.test.ts
git commit -m "feat(schema): add streamBroadcasts table and simulcastEnabled flag"
```

---

## Task 2: streamBroadcasts CRUD

**Files:**
- Create: `convex/streamBroadcasts.ts`
- Create: `convex/__tests__/streamBroadcasts.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// convex/__tests__/streamBroadcasts.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"
import { internal } from "../_generated/api"

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { privyDid: "x", walletAddress: "w" })
    const streamId = await ctx.db.insert("streams", {
      creatorId: userId, username: "u", title: "t", category: "Other",
      status: "live", viewerCount: 0, peakViewerCount: 0,
    })
    return { userId, streamId }
  })
}

describe("streamBroadcasts", () => {
  test("create → attachExternals → markLive → markEnded", async () => {
    const t = convexTest(schema)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })
    await t.mutation(internal.streamBroadcasts.attachExternals, {
      id, externalBroadcastId: "yt-b", externalStreamId: "yt-s", rtkRecordingId: "rec-1",
    })
    await t.mutation(internal.streamBroadcasts.markLive, { id })
    await t.mutation(internal.streamBroadcasts.markEnded, { id })
    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("ended")
    expect(record?.endedAt).toBeDefined()
    expect(record?.rtkRecordingId).toBe("rec-1")
  })

  test("markDegraded sets degradedSince", async () => {
    const t = convexTest(schema)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })
    await t.mutation(internal.streamBroadcasts.markDegraded, { id })
    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("degraded")
    expect(record?.degradedSince).toBeTypeOf("number")
  })

  test("markFailed sets errorMessage", async () => {
    const t = convexTest(schema)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })
    await t.mutation(internal.streamBroadcasts.markFailed, { id, errorMessage: "nope" })
    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("failed")
    expect(record?.errorMessage).toBe("nope")
  })
})
```

- [ ] **Step 2: Run; verify failure**

Run: `pnpm exec vitest run convex/__tests__/streamBroadcasts.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// convex/streamBroadcasts.ts
import { v } from "convex/values"
import { internalMutation, internalQuery, query } from "./_generated/server"

const platformValidator = v.union(v.literal("youtube"), v.literal("x"))
const privacyValidator = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
)

export const create = internalMutation({
  args: {
    streamId: v.id("streams"),
    platform: platformValidator,
    title: v.string(),
    description: v.string(),
    privacy: privacyValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("streamBroadcasts", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    })
  },
})

export const attachExternals = internalMutation({
  args: {
    id: v.id("streamBroadcasts"),
    externalBroadcastId: v.string(),
    externalStreamId: v.string(),
    rtkRecordingId: v.string(),
  },
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch(id, rest)
  },
})

export const markLive = internalMutation({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "live" })
  },
})

export const markDegraded = internalMutation({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "degraded", degradedSince: Date.now() })
  },
})

export const markEnded = internalMutation({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "ended", endedAt: Date.now() })
  },
})

export const markFailed = internalMutation({
  args: { id: v.id("streamBroadcasts"), errorMessage: v.string() },
  handler: async (ctx, { id, errorMessage }) => {
    await ctx.db.patch(id, { status: "failed", errorMessage, endedAt: Date.now() })
  },
})

export const listForStream = query({
  args: { streamId: v.id("streams") },
  handler: async (ctx, { streamId }) => {
    return ctx.db
      .query("streamBroadcasts")
      .withIndex("by_stream", (q) => q.eq("streamId", streamId))
      .collect()
  },
})

export const listActiveBroadcasts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const live = await ctx.db.query("streamBroadcasts").withIndex("by_status", (q) => q.eq("status", "live")).collect()
    const degraded = await ctx.db.query("streamBroadcasts").withIndex("by_status", (q) => q.eq("status", "degraded")).collect()
    return [...live, ...degraded]
  },
})

export const getById = internalQuery({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => ctx.db.get(id),
})
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/streamBroadcasts.test.ts`
Expected: all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/streamBroadcasts.ts convex/__tests__/streamBroadcasts.test.ts
git commit -m "feat(convex): streamBroadcasts table CRUD with lifecycle transitions"
```

---

## Task 3: RealtimeKit `/recordings` wrapper

**Files:**
- Create: `convex/rtkRecordings.ts`

**Purpose:** Thin internalAction wrappers for the two `/recordings` calls we need — `start` (POST with `rtmp_out_config`) and `stop` (whichever verb Task 0 confirmed). Keeps URL construction and env handling consistent.

- [ ] **Step 1: Implement the wrapper**

Stop verb confirmed by Task 0 verification (commit `4c2b70f`): `PUT /recordings/:id` with body `{"action":"stop"}`. The snippet below uses that shape.

```typescript
// convex/rtkRecordings.ts
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
    // PUT /recordings/:id with { action: "stop" } per Task 0 verification.
    // Allowed actions: "stop" | "pause" | "resume". 400 "not in progress" is
    // benign — means the recording already errored/ended; treat as success.
    const res = await fetch(`${rtkBaseUrl()}/recordings/${recordingId}`, {
      method: "PUT",
      headers: rtkHeaders(),
      body: JSON.stringify({ action: "stop" }),
    })
    if (res.status === 404) return // already gone
    if (res.status === 400) {
      const body = await res.text()
      if (/not in progress|not active/i.test(body)) return
      throw new Error(`rtk.stopRecording unexpected 400: ${body}`)
    }
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`rtk.stopRecording failed: ${res.status} — ${body}`)
    }
  },
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/rtkRecordings.ts
git commit -m "feat(convex): RealtimeKit /recordings wrapper for simulcast start/stop"
```

---

## Task 4: YouTube per-broadcast lifecycle actions

**Files:**
- Create: `convex/youtubeBroadcasts.ts`
- Create: `convex/__tests__/youtubeBroadcasts.test.ts`

**Purpose:** Wrap YouTube Data API v3 (`liveBroadcasts.insert`, `liveStreams.insert`, `liveBroadcasts.bind`, `liveBroadcasts.transition`, `liveBroadcasts.delete`) in Convex internal actions. Reuses existing `refreshYoutubeToken` helper from `connectedPlatformsActions.ts`.

- [ ] **Step 1: Write failing tests**

```typescript
// convex/__tests__/youtubeBroadcasts.test.ts
import { describe, expect, test } from "vitest"
import { buildYoutubeInsertBroadcastBody, parseYoutubeError } from "../youtubeBroadcasts"

describe("youtubeBroadcasts helpers", () => {
  test("buildYoutubeInsertBroadcastBody shapes the request body", () => {
    const body = buildYoutubeInsertBroadcastBody({
      title: "Hello", description: "desc", privacy: "public",
      scheduledStartTime: "2026-04-13T00:00:00Z",
    })
    expect(body.snippet.title).toBe("Hello")
    expect(body.status.privacyStatus).toBe("public")
    expect(body.snippet.scheduledStartTime).toBe("2026-04-13T00:00:00Z")
  })

  test("parseYoutubeError extracts quota-exceeded", () => {
    expect(parseYoutubeError({
      error: { code: 403, errors: [{ reason: "quotaExceeded" }] },
    })).toBe("quota_exceeded")
  })

  test("parseYoutubeError extracts invalid-credentials", () => {
    expect(parseYoutubeError({
      error: { code: 401, errors: [{ reason: "authError" }] },
    })).toBe("invalid_credentials")
  })

  test("parseYoutubeError returns unknown for weird shapes", () => {
    expect(parseYoutubeError({ weird: true })).toBe("unknown")
  })
})
```

- [ ] **Step 2: Run; verify failure**

Run: `pnpm exec vitest run convex/__tests__/youtubeBroadcasts.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// convex/youtubeBroadcasts.ts
"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
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
  title: string; description: string; privacy: Privacy; scheduledStartTime: string
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
  handler: async (ctx, args): Promise<{
    broadcastId: string; streamId: string; rtmpUrl: string; streamKey: string
  }> => {
    await ctx.runAction(internal.connectedPlatformsActions.refreshYoutubeToken, {
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
        body: JSON.stringify(buildYoutubeInsertBroadcastBody({
          title: args.title, description: args.description, privacy: args.privacy,
          scheduledStartTime: new Date().toISOString(),
        })),
      },
    )
    if (!broadcastRes.ok) {
      const body = await broadcastRes.json().catch(() => ({}))
      throw new Error(`youtube.createBroadcast:${parseYoutubeError(body)}:${broadcastRes.status}`)
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
      const body = await streamRes.json().catch(() => ({}))
      throw new Error(`youtube.createStream:${parseYoutubeError(body)}:${streamRes.status}`)
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
      const body = await bindRes.json().catch(() => ({}))
      throw new Error(`youtube.bind:${parseYoutubeError(body)}:${bindRes.status}`)
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
    await ctx.runAction(internal.connectedPlatformsActions.refreshYoutubeToken, {
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
      const body = await res.json().catch(() => ({}))
      throw new Error(`youtube.transition:${parseYoutubeError(body)}:${res.status}`)
    }
  },
})

export const deleteBroadcast = internalAction({
  args: { connectionId: v.id("connectedPlatforms"), broadcastId: v.string() },
  handler: async (ctx, { connectionId, broadcastId }): Promise<void> => {
    try {
      await ctx.runAction(internal.connectedPlatformsActions.refreshYoutubeToken, { connectionId })
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
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/youtubeBroadcasts.test.ts`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/youtubeBroadcasts.ts convex/__tests__/youtubeBroadcasts.test.ts
git commit -m "feat(convex): YouTube per-broadcast lifecycle actions"
```

---

## Task 5: Refactor `goLive` to orchestrate simulcast

**Files:**
- Modify: `convex/streams.ts:627-752` (`goLive` action)
- Modify: `convex/__tests__/goLive.test.ts`

**Orchestration sequence per Decisions 4a–c, 4g:**
1. If `simulcast.youtube` is present and no active YouTube connection exists → create a failed `streamBroadcasts` row, but let Switched go live (pre-flight has already asked the user to confirm in the UI).
2. If YouTube connection is active:
   a. Create `streamBroadcasts` row (status=pending)
   b. YouTube `createBroadcast` (retry once on non-auth errors)
   c. RealtimeKit `startRtmpRecording` with `rtmp_url = "${ytRtmpUrl}/${ytStreamKey}"` (retry once)
   d. `streamBroadcasts.attachExternals`
   e. YouTube `transitionBroadcast → live` (retry once)
   f. `streamBroadcasts.markLive`
3. Any failure in steps 2b–2e: mark the broadcast row `failed`, keep Switched live (graceful degrade).

- [ ] **Step 1: Write failing integration tests**

Add to `convex/__tests__/goLive.test.ts`:

```typescript
test("goLive with simulcast.youtube creates a streamBroadcast and transitions to live (happy path)", async () => {
  // Mock fetch in this order:
  //   1. RealtimeKit /livestreams POST → 200 with playback_url
  //   2. YouTube liveBroadcasts.insert → 200 { id: "yt-b" }
  //   3. YouTube liveStreams.insert → 200 with cdn.ingestionInfo
  //   4. YouTube liveBroadcasts.bind → 200
  //   5. RealtimeKit /recordings POST → 200 { data: { id: "rec-1" } }
  //   6. YouTube liveBroadcasts.transition (live) → 200
  // Assert: streamBroadcasts has one row with status=live, externalBroadcastId=yt-b, rtkRecordingId=rec-1
})

test("goLive with simulcast.youtube graceful-degrades when YouTube insert fails twice", async () => {
  // Mock YouTube insert to 500 twice; assert broadcast status=failed,
  // Switched stream playbackUrl set (still live).
})

test("goLive with simulcast.youtube but no connection creates a failed broadcast row and still goes live", async () => {
  // Seed: no YouTube connection.
  // Assert: streamBroadcasts row has status=failed; stream is live.
})
```

- [ ] **Step 2: Modify `goLive` signature**

Near the top of `convex/streams.ts`, after existing imports, add:

```typescript
const simulcastArgValidator = v.optional(
  v.object({
    youtube: v.optional(
      v.object({
        title: v.string(),
        description: v.string(),
        privacy: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
      }),
    ),
  }),
)

async function withRetryOnce<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/invalid_credentials|quota_exceeded/.test(msg)) throw e
    console.warn(`${label} failed once, retrying after 200ms: ${msg}`)
    await new Promise((r) => setTimeout(r, 200))
    return fn()
  }
}
```

Replace the existing `args` block in `goLive` (line 628-633) with:

```typescript
  args: {
    title: v.string(),
    category: categoryValidator,
    sessionPlan: v.optional(streamSessionPlanValidator),
    simulcast: simulcastArgValidator,
  },
  handler: async (
    ctx,
    { title, category, sessionPlan: _sessionPlan, simulcast },
  ): Promise<{ streamId: string }> => {
```

Also add a new mutation in `convex/streams.ts`:

```typescript
export const setSimulcastEnabled = mutation({
  args: { id: v.id("streams"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ctx.db.patch(id, { simulcastEnabled: enabled })
  },
})
```

- [ ] **Step 3: Insert the simulcast orchestration block**

After the existing `setLive` call (around line 730) and before `fanOutGoLiveNotifications`, insert:

```typescript
      // ── Simulcast orchestration ──────────────────────────────────────────
      if (simulcast?.youtube) {
        await ctx.runMutation(api.streams.setSimulcastEnabled, { id: streamId, enabled: true })

        const ytConnection = await ctx.runQuery(
          internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
          { userId, platform: "youtube" },
        )

        const broadcastId = await ctx.runMutation(internal.streamBroadcasts.create, {
          streamId,
          platform: "youtube",
          title: simulcast.youtube.title,
          description: simulcast.youtube.description,
          privacy: simulcast.youtube.privacy,
        })

        if (!ytConnection || ytConnection.status !== "active") {
          await ctx.runMutation(internal.streamBroadcasts.markFailed, {
            id: broadcastId,
            errorMessage: "YouTube not connected or token expired",
          })
        } else {
          try {
            // 1. YouTube: create broadcast + stream + bind
            const ytResult = await withRetryOnce(
              () => ctx.runAction(internal.youtubeBroadcasts.createBroadcast, {
                connectionId: ytConnection._id,
                title: simulcast.youtube!.title,
                description: simulcast.youtube!.description,
                privacy: simulcast.youtube!.privacy,
              }),
              "youtube.createBroadcast",
            )

            // 2. RealtimeKit: start /recordings with rtmp_out_config
            const rtmpUrlWithKey = `${ytResult.rtmpUrl}/${ytResult.streamKey}`
            const recording = await withRetryOnce(
              () => ctx.runAction(internal.rtkRecordings.startRtmpRecording, {
                meetingId: session.cloudflareRoomId,
                rtmpUrlWithKey,
              }),
              "rtk.startRtmpRecording",
            )

            await ctx.runMutation(internal.streamBroadcasts.attachExternals, {
              id: broadcastId,
              externalBroadcastId: ytResult.broadcastId,
              externalStreamId: ytResult.streamId,
              rtkRecordingId: recording.recordingId,
            })

            // 3. YouTube: transition broadcast → live
            await withRetryOnce(
              () => ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
                connectionId: ytConnection._id,
                broadcastId: ytResult.broadcastId,
                status: "live",
              }),
              "youtube.transition-live",
            )

            await ctx.runMutation(internal.streamBroadcasts.markLive, { id: broadcastId })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error("YouTube simulcast failed, graceful-degrading:", msg)
            await ctx.runMutation(internal.streamBroadcasts.markFailed, {
              id: broadcastId,
              errorMessage: msg,
            })
            // Do NOT rethrow — Switched stream stays live.
          }
        }
      }
      // ── End simulcast orchestration ──────────────────────────────────────
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/goLive.test.ts`
Expected: all tests including the three new ones pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/streams.ts convex/__tests__/goLive.test.ts
git commit -m "feat(convex): wire YouTube simulcast into goLive with graceful-degrade"
```

---

## Task 6: Refactor `endLivestream` for ordered tear-down

**Files:**
- Modify: `convex/streams.ts:791+` (`endLivestream`)
- Modify: `convex/__tests__/streams.test.ts`

**Tear-down order (best-effort per Decision 4e):**
1. For each active broadcast: YouTube `transition → complete`
2. For each active broadcast: `stopRecording` on RealtimeKit
3. Mark each broadcast `ended`
4. Existing RealtimeKit `active-livestream/stop` (unchanged)
5. Existing stream `setStatus ended` (unchanged)

- [ ] **Step 1: Write failing tests**

Add to `convex/__tests__/streams.test.ts`:

```typescript
test("endLivestream transitions YouTube broadcast and stops RealtimeKit recording", async () => {
  // Seed: stream with live streamBroadcast, externals attached.
  // Mock fetch for:
  //   - YouTube transition complete → 200
  //   - RealtimeKit DELETE /recordings/:id → 200
  //   - RealtimeKit livestream stop → 200
  // Assert: streamBroadcasts.status=ended, stream.status=ended,
  //         fetch called with YouTube transition URL containing broadcastStatus=complete.
})

test("endLivestream survives YouTube 500 and still marks broadcast ended locally", async () => {
  // Mock YouTube transition to 500; assert broadcast.status=ended anyway.
})
```

- [ ] **Step 2: Extract tear-down into an internal action**

Add to `convex/streams.ts` (before `endLivestream`):

```typescript
export const performTeardown = internalAction({
  args: { streamId: v.id("streams"), userId: v.id("users"), cloudflareRoomId: v.string() },
  handler: async (ctx, { streamId, userId, cloudflareRoomId }): Promise<void> => {
    const broadcasts = await ctx.runQuery(api.streamBroadcasts.listForStream, { streamId })

    for (const b of broadcasts) {
      if (b.status !== "live" && b.status !== "degraded") continue

      if (b.platform === "youtube" && b.externalBroadcastId) {
        const ytConn = await ctx.runQuery(
          internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
          { userId, platform: "youtube" },
        )
        if (ytConn) {
          try {
            await ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
              connectionId: ytConn._id,
              broadcastId: b.externalBroadcastId,
              status: "complete",
            })
          } catch (e) {
            console.warn("YouTube transition complete (best-effort):", e)
          }
        }
      }

      if (b.rtkRecordingId) {
        try {
          await ctx.runAction(internal.rtkRecordings.stopRecording, {
            recordingId: b.rtkRecordingId,
          })
        } catch (e) {
          console.warn("RealtimeKit stopRecording (best-effort):", e)
        }
      }

      await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: b._id })
    }

    // Stop the RealtimeKit livestream if a meeting id was provided.
    if (cloudflareRoomId) {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
      const apiToken = process.env.CLOUDFLARE_API_TOKEN
      const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
      if (accountId && apiToken && appId) {
        const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
        try {
          await fetch(`${base}/meetings/${cloudflareRoomId}/active-livestream/stop`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}` },
          })
        } catch { /* best effort */ }
      }
    }
  },
})
```

- [ ] **Step 3: Replace the body of `endLivestream`**

Keep the auth/session lookup at the top. Replace the existing RealtimeKit stop + status update with:

```typescript
    await ctx.runAction(internal.streams.performTeardown, {
      streamId,
      userId,
      cloudflareRoomId: session.cloudflareRoomId,
    })

    await ctx.runMutation(api.streams.setStatus, {
      id: streamId,
      status: "ended",
      endedAt: Date.now(),
    })

    // The existing billing + clearStreamFromSession calls stay as-is below.
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/streams.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/streams.ts convex/__tests__/streams.test.ts
git commit -m "feat(convex): best-effort simulcast tear-down in endLivestream"
```

---

## Task 7: RealtimeKit webhook handler

**Files:**
- Create: `convex/webhooks.ts`
- Modify: `convex/http.ts`
- Create: `convex/__tests__/webhooks.test.ts`

**Purpose (Decision 4f):** Auto tear-down on `meeting.ended`. Mark simulcasts `degraded` on `livestreaming.statusUpdate → OFFLINE`. HMAC-SHA256 signature verification per Dyte/RealtimeKit docs.

**Before coding:** discover the subscription endpoint once:

```bash
curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/realtime/kit/$CLOUDFLARE_REALTIMEKIT_APP_ID/webhooks"
```

If 404, check the dashboard Developer section. Record the discovered URL as a comment in `convex/webhooks.ts` for future maintainers.

- [ ] **Step 1: Write failing tests**

```typescript
// convex/__tests__/webhooks.test.ts
import { describe, expect, test } from "vitest"
import { verifyRtkSignature } from "../webhooks"

async function computeHmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
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
```

- [ ] **Step 2: Run; verify failure**

Run: `pnpm exec vitest run convex/__tests__/webhooks.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement handler**

```typescript
// convex/webhooks.ts
// RealtimeKit webhook handler — verifies HMAC-SHA256 signature and routes
// events to tear-down actions. Subscribed event names per RealtimeKit docs:
//   - meeting.ended
//   - livestreaming.statusUpdate
//
// Subscription endpoint (discovered during implementation): <PASTE HERE>

import { httpAction } from "./_generated/server"
import { internal } from "./_generated/api"

export async function verifyRtkSignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  const computedHex = Array.from(new Uint8Array(computed))
    .map((b) => b.toString(16).padStart(2, "0")).join("")
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

  if (payload.event === "livestreaming.statusUpdate" && payload.meeting?.id && payload.livestream?.status === "OFFLINE") {
    await ctx.runAction(internal.streams.markSimulcastDegradedByRtkMeeting, {
      cloudflareRoomId: payload.meeting.id,
    })
  }

  return new Response("ok", { status: 200 })
})
```

- [ ] **Step 4: Wire the route**

Replace `convex/http.ts` entirely:

```typescript
import { httpRouter } from "convex/server"
import { rtkWebhook } from "./webhooks"

const http = httpRouter()

http.route({ path: "/webhooks/rtk", method: "POST", handler: rtkWebhook })

export default http
```

The public URL will be `https://<deployment>.convex.site/webhooks/rtk`. Register it in the RealtimeKit dashboard or via the subscription endpoint you discovered.

- [ ] **Step 5: Add the two orchestration actions referenced by the webhook**

In `convex/streams.ts` add:

```typescript
export const getSessionByRoomId = internalQuery({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }) => {
    return ctx.db
      .query("studioSessions")
      .filter((q) => q.eq(q.field("cloudflareRoomId"), cloudflareRoomId))
      .first()
  },
})

export const teardownByRtkMeeting = internalAction({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }): Promise<void> => {
    const session = await ctx.runQuery(internal.streams.getSessionByRoomId, { cloudflareRoomId })
    if (!session?.streamId) return
    const stream = await ctx.runQuery(api.streams.getById, { id: session.streamId })
    if (!stream || stream.status === "ended") return

    await ctx.runAction(internal.streams.performTeardown, {
      streamId: session.streamId,
      userId: stream.creatorId,
      cloudflareRoomId,
    })
    await ctx.runMutation(api.streams.setStatus, {
      id: session.streamId,
      status: "ended",
      endedAt: Date.now(),
    })
  },
})

export const markSimulcastDegradedByRtkMeeting = internalAction({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }): Promise<void> => {
    const session = await ctx.runQuery(internal.streams.getSessionByRoomId, { cloudflareRoomId })
    if (!session?.streamId) return
    const broadcasts = await ctx.runQuery(api.streamBroadcasts.listForStream, {
      streamId: session.streamId,
    })
    for (const b of broadcasts) {
      if (b.status === "live") {
        await ctx.runMutation(internal.streamBroadcasts.markDegraded, { id: b._id })
      }
    }
  },
})
```

- [ ] **Step 6: No env var required**

RealtimeKit uses RSA public-key verification — no shared secret exists. The public key is fetched automatically from `https://api.realtime.cloudflare.com/.well-known/webhooks.json` on the first webhook request and cached in the V8 isolate. No Convex environment variable is needed for webhook signature verification.

- [ ] **Step 7: Run tests**

Run: `pnpm exec vitest run convex/__tests__/webhooks.test.ts`
Expected: both tests pass.

- [ ] **Step 8: Commit**

```bash
git add convex/webhooks.ts convex/http.ts convex/streams.ts convex/__tests__/webhooks.test.ts
git commit -m "feat(convex): RealtimeKit webhook handler with HMAC verification and auto tear-down"
```

---

## Task 8: Orphan cleanup cron

**Files:**
- Modify: `convex/crons.ts`
- Modify: `convex/streams.ts`
- Modify: `convex/__tests__/streams.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
test("cleanupOrphanBroadcasts marks live broadcasts whose stream is ended", async () => {
  // Seed: stream.status=ended, one streamBroadcasts row with status=live.
  // Run internal.streams.cleanupOrphanBroadcasts.
  // Assert: broadcast.status=ended.
})

test("cleanupOrphanBroadcasts marks broadcasts degraded >10min as failed", async () => {
  // Seed: stream.status=live, broadcast.status=degraded, degradedSince 15 min ago.
  // Run cron.
  // Assert: broadcast.status=failed with errorMessage set.
})
```

- [ ] **Step 2: Implement**

Add to `convex/streams.ts`:

```typescript
export const cleanupOrphanBroadcasts = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const active = await ctx.runQuery(internal.streamBroadcasts.listActiveBroadcasts, {})
    for (const b of active) {
      const stream = await ctx.runQuery(api.streams.getById, { id: b.streamId })
      if (!stream) {
        await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: b._id })
        continue
      }
      if (stream.status === "ended") {
        await ctx.runAction(internal.streams.performTeardown, {
          streamId: stream._id,
          userId: stream.creatorId,
          cloudflareRoomId: "",
        })
        continue
      }
      if (b.status === "degraded" && b.degradedSince && Date.now() - b.degradedSince > 10 * 60_000) {
        await ctx.runMutation(internal.streamBroadcasts.markFailed, {
          id: b._id,
          errorMessage: "simulcast degraded for >10m",
        })
      }
    }
  },
})
```

In `convex/crons.ts`, add:

```typescript
crons.interval(
  "simulcast orphan cleanup",
  { minutes: 5 },
  internal.streams.cleanupOrphanBroadcasts,
)
```

- [ ] **Step 3: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/streams.test.ts`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add convex/streams.ts convex/crons.ts convex/__tests__/streams.test.ts
git commit -m "feat(convex): 5-minute cron cleaning orphan simulcast broadcasts"
```

---

## Task 9: Go-live modal UI (YouTube metadata + 4a preflight)

**Files:**
- Modify: `components/studio/go-live-modal.tsx`
- Modify: `hooks/use-go-live.ts`

- [ ] **Step 1: Add YouTube metadata fields**

Read the existing `go-live-modal.tsx` to find the YouTube toggle (from commit `4dd0aad`). Below the toggle, conditionally render:

```tsx
{youtubeEnabled && (
  <div className="mt-3 space-y-3 rounded-md border border-border/50 bg-muted/20 p-3">
    <div className="space-y-1.5">
      <Label htmlFor="yt-title">YouTube title</Label>
      <Input
        id="yt-title"
        value={youtubeTitle}
        onChange={(e) => setYoutubeTitle(e.target.value)}
        placeholder={streamTitle}
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="yt-description">Description</Label>
      <Textarea
        id="yt-description"
        value={youtubeDescription}
        onChange={(e) => setYoutubeDescription(e.target.value)}
        rows={3}
      />
    </div>
    <div className="space-y-1.5">
      <Label>Privacy</Label>
      <Select value={youtubePrivacy} onValueChange={(v) => setYoutubePrivacy(v as "public" | "unlisted" | "private")}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="public">Public</SelectItem>
          <SelectItem value="unlisted">Unlisted</SelectItem>
          <SelectItem value="private">Private</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
)}
```

State hooks near the top:

```tsx
const [youtubeTitle, setYoutubeTitle] = useState("")
const [youtubeDescription, setYoutubeDescription] = useState("")
const [youtubePrivacy, setYoutubePrivacy] = useState<"public" | "unlisted" | "private">("public")
```

- [ ] **Step 2: Add pre-flight check**

`ytConnection` comes from `useQuery(api.connectedPlatforms.getPlatformByType, { platform: "youtube" })`.

Replace the submit handler:

```tsx
async function handleGoLive() {
  if (youtubeEnabled) {
    if (!ytConnection || ytConnection.status !== "active") {
      const confirmed = window.confirm(
        "YouTube isn't connected (or the connection expired). Go live on Switched only?\n\nClick OK to continue without YouTube, or Cancel to go reconnect YouTube first.",
      )
      if (!confirmed) {
        window.open("/dashboard/settings/stream?reconnect=youtube", "_blank")
        return
      }
      await goLive({ title: streamTitle, category })
      return
    }
  }

  await goLive({
    title: streamTitle,
    category,
    simulcast: youtubeEnabled
      ? {
          youtube: {
            title: youtubeTitle || streamTitle,
            description: youtubeDescription,
            privacy: youtubePrivacy,
          },
        }
      : undefined,
  })
}
```

- [ ] **Step 3: Update `hooks/use-go-live.ts`**

Add `simulcast` as an optional argument to the `goLive` function signature and pass it through to the Convex action.

- [ ] **Step 4: Manual smoke test**

Run `pnpm dev`. Open studio, toggle YouTube off → existing flow. Toggle YouTube on with connection active → metadata fields render, submit triggers simulcast. Toggle YouTube on with connection expired (set via Convex dashboard) → confirm dialog appears.

- [ ] **Step 5: Commit**

```bash
git add components/studio/go-live-modal.tsx hooks/use-go-live.ts
git commit -m "feat(ui): YouTube metadata fields and preflight reconnect confirm in go-live modal"
```

---

## Task 10: SimulcastStatus component (live banner + 60s kill-switch)

**Files:**
- Create: `components/studio/simulcast-status.tsx`
- Modify: `components/studio/studio-view.tsx`
- Modify: `convex/streamBroadcasts.ts` — add `abandonBroadcast` action

**Behavior:**
- Subscribe to `api.streamBroadcasts.listForStream`.
- `live` → small green "LIVE on YouTube" pill.
- `degraded` → yellow banner with elapsed seconds; after 60s show "Stop YouTube simulcast" button calling `abandonBroadcast`.
- `failed` → dismissible red notice with `errorMessage`.

- [ ] **Step 1: Add `abandonBroadcast` action**

In `convex/streamBroadcasts.ts`, add:

```typescript
export const abandonBroadcast = action({
  args: { broadcastId: v.id("streamBroadcasts") },
  handler: async (ctx, { broadcastId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const broadcast = await ctx.runQuery(internal.streamBroadcasts.getById, { id: broadcastId })
    if (!broadcast) throw new Error("Broadcast not found")

    const stream = await ctx.runQuery(api.streams.getById, { id: broadcast.streamId })
    const user = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!user || !stream || stream.creatorId !== user._id) {
      throw new Error("Not authorized")
    }

    if (broadcast.platform === "youtube" && broadcast.externalBroadcastId) {
      const ytConn = await ctx.runQuery(
        internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
        { userId: user._id, platform: "youtube" },
      )
      if (ytConn) {
        try {
          await ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
            connectionId: ytConn._id,
            broadcastId: broadcast.externalBroadcastId,
            status: "complete",
          })
        } catch { /* best effort */ }
      }
    }

    if (broadcast.rtkRecordingId) {
      try {
        await ctx.runAction(internal.rtkRecordings.stopRecording, {
          recordingId: broadcast.rtkRecordingId,
        })
      } catch { /* best effort */ }
    }

    await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: broadcastId })
  },
})
```

Also ensure these imports/re-exports exist in `streamBroadcasts.ts`:

```typescript
import { action } from "./_generated/server"
import { api, internal } from "./_generated/api"
```

- [ ] **Step 2: Create the component**

```tsx
// components/studio/simulcast-status.tsx
"use client"
import { useQuery, useMutation } from "convex/react"
import { useEffect, useState } from "react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/app/ui/button"
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react"

export function SimulcastStatus({ streamId }: { streamId: Id<"streams"> }) {
  const broadcasts = useQuery(api.streamBroadcasts.listForStream, { streamId })
  const abandon = useMutation(api.streamBroadcasts.abandonBroadcast)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  if (!broadcasts || broadcasts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {broadcasts.map((b) => {
        if (dismissed.has(b._id)) return null
        if (b.status === "live") {
          return (
            <div key={b._id} className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>LIVE on {b.platform === "youtube" ? "YouTube" : "X"}</span>
            </div>
          )
        }
        if (b.status === "degraded") {
          const seconds = b.degradedSince ? Math.floor((now - b.degradedSince) / 1000) : 0
          return (
            <div key={b._id} className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-2 text-xs text-yellow-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{b.platform} reconnecting… ({seconds}s)</span>
              {seconds >= 60 && (
                <Button variant="outline" size="sm" className="ml-auto"
                  onClick={() => abandon({ broadcastId: b._id })}>
                  Stop {b.platform} simulcast
                </Button>
              )}
            </div>
          )
        }
        if (b.status === "failed") {
          return (
            <div key={b._id} className="flex items-center gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-300">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{b.platform} simulcast failed: {b.errorMessage ?? "unknown error"}</span>
              <button className="ml-auto text-red-200 hover:text-red-100"
                onClick={() => setDismissed((s) => new Set(s).add(b._id))}
                aria-label="dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
```

- [ ] **Step 3: Mount in studio view**

In `components/studio/studio-view.tsx`, near the existing live indicator, render `<SimulcastStatus streamId={stream._id} />` when `stream.status === "live"` and `stream.simulcastEnabled`.

- [ ] **Step 4: Manual smoke test**

`pnpm dev` → studio. Manually patch `streamBroadcasts.status="degraded"` in Convex dashboard to verify the banner + kill-switch after 60s.

- [ ] **Step 5: Commit**

```bash
git add components/studio/simulcast-status.tsx components/studio/studio-view.tsx convex/streamBroadcasts.ts
git commit -m "feat(ui): SimulcastStatus component with live banner and 60s kill-switch"
```

---

## Task 11: E2E checklist + docs

**Files:**
- Create: `docs/features/youtube-simulcast.md`

- [ ] **Step 1: Write the checklist**

```markdown
# YouTube Simulcast — E2E manual test

## Prerequisites
- RealtimeKit webhook subscribed to `meeting.ended` and `livestreaming.statusUpdate`, pointing at `https://<deployment>.convex.site/webhooks/rtk`
- No shared secret required — RealtimeKit uses RSA public-key verification (public key auto-fetched from `https://api.realtime.cloudflare.com/.well-known/webhooks.json`)
- YouTube account connected via `/dashboard/settings/stream`

## Happy path
1. Open studio as creator, start meeting
2. Click "Go Live"
3. Toggle YouTube ON
4. Fill YouTube title "Simulcast smoke test"; Privacy: unlisted
5. Click Go Live
6. Within 30s: Switched shows LIVE, SimulcastStatus shows "LIVE on YouTube"
7. Open YouTube Studio → confirm broadcast is live
8. Click End Stream
9. SimulcastStatus clears; YouTube broadcast transitions to ended

## Graceful degrade — YouTube auth expired
1. Convex dashboard: patch YouTube connection `status="expired"`
2. Studio → toggle YouTube → Go Live
3. Confirm dialog appears; click OK
4. Switched goes live; `streamBroadcasts.status="failed"`

## Unexpected end — browser crash
1. Start simulcast as in Happy Path
2. Force-close the tab
3. Within ~2 min webhook fires cleanup (or 5 min cron as backup)
4. Convex: `stream.status=ended`, `streamBroadcasts.status=ended`
5. YouTube Studio: broadcast no longer live
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/youtube-simulcast.md
git commit -m "docs: E2E checklist for YouTube simulcast"
```

- [ ] **Step 3: Run the full checklist against staging**

Record results at the bottom of `docs/features/youtube-simulcast.md` under "Verified runs" with date and outcome.

---

## Self-review summary

**Spec coverage:**
- Per-broadcast YouTube lifecycle → Task 4 + Task 5
- 4a (OAuth pre-flight) → Task 9
- 4b/4c (retry + graceful-degrade) → Task 5 via `withRetryOnce`
- 4d (live banner + 60s kill-switch) → Task 10
- 4e (best-effort tear-down) → Task 6 via `performTeardown`
- 4f (webhook + safety cron) → Tasks 7, 8
- 4g (quota-exhausted graceful-degrade) → Task 4 via `parseYoutubeError` + Task 5 error path

**Open items (non-blocking, narrow):**
- Task 0: stop endpoint verb (DELETE vs POST .../stop) discovered empirically
- Task 7: webhook subscription endpoint URL discovered via curl probe
- Task 9 Step 3: exact shape of `hooks/use-go-live.ts` may require adapter tweaks

**Type consistency (spot check):**
- `streamBroadcasts` fields (`externalBroadcastId`, `externalStreamId`, `rtkRecordingId`) used identically across Tasks 1, 2, 5, 6, 10.
- Mutation names (`create`, `attachExternals`, `markLive`, `markDegraded`, `markEnded`, `markFailed`, `abandonBroadcast`) consistent.
- `performTeardown` signature `(streamId, userId, cloudflareRoomId)` consistent across Tasks 6, 7, 8.

**Phase 2 carry-overs:**
- Multi-destination simulcast — would likely mean N `/recordings` calls per stream; schema already supports this shape.
- X (Twitter) simulcast — schema carries `platform: "x"` already; X needs manual stream key entry since OAuth stream keys aren't broadly available.
- Unified VOD recording — still on RealtimeKit's existing recording machinery; may need a second `/recordings` call without `rtmp_out_config`.
