# YouTube Simulcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a Switched creator to simulcast a live stream to YouTube in parallel with the Switched HLS feed, using Cloudflare Stream Live Inputs + Live Outputs as the simulcast layer, with per-broadcast YouTube lifecycle management.

**Architecture:**
Video flows RealtimeKit meeting → RealtimeKit livestream (pushed via RTMP to a per-creator Cloudflare Stream Live Input) → (a) HLS to Switched viewers, (b) Live Output RTMP push to YouTube. Each go-live creates a fresh YouTube `liveBroadcast` + `liveStream`, binds them, transitions to `live` on RealtimeKit start, transitions to `complete` on stream end. A per-creator Live Input is provisioned lazily on first go-live and reused forever. RealtimeKit `meeting.ended` webhook drives graceful tear-down on unexpected exits, with a safety-net cron.

**Tech Stack:** Convex (actions, mutations, HTTP actions, crons), Cloudflare Stream REST API, YouTube Data API v3 (liveBroadcasts, liveStreams), RealtimeKit REST + webhooks, Next.js / React UI, existing AES-256-GCM token encryption in `convex/lib/tokenEncryption.ts`.

**Decisions locked in** (from design conversation 2026-04-12/13):
- **Option A BLOCKED on 2026-04-12**: RealtimeKit livestream POST rejects `destinations` field — response: `422 {"message":"[body] \"destinations\" is not allowed","success":false}`. External RTMP out is not supported by this API. Stop and pivot to Option B before continuing.
- Option A (RealtimeKit → Stream Live Input → Simulcast Outputs) — BLOCKED, see above
- Per-creator persistent Live Input
- Per-broadcast YouTube lifecycle
- 4a: confirm modal on OAuth failure
- 4b / 4c: retry-once-with-backoff, then graceful-degrade
- 4d: live banner + 60s kill-switch
- 4e: best-effort tear-down
- 4f: RealtimeKit webhook + safety cron
- 4g: graceful-degrade on quota exhaustion

---

## File Structure

**New files:**
- `convex/cloudflareStream.ts` — Convex actions for Live Input + Live Output management
- `convex/youtubeBroadcasts.ts` — Convex actions for YouTube per-broadcast lifecycle
- `convex/webhooks.ts` — HTTP action: RealtimeKit webhook handler + signature verification
- `convex/streamBroadcasts.ts` — queries/mutations for the new `streamBroadcasts` table
- `convex/creatorLiveInputs.ts` — queries/mutations for the new `creatorLiveInputs` table
- `lib/cloudflare-stream.ts` — shared request helper (used inside Convex actions; no `"use node"`)
- `lib/queries/cloudflare-stream.ts` — TanStack read-only polling for Live Input status
- `components/studio/simulcast-status.tsx` — live banner + kill-switch UI

**Modified files:**
- `convex/schema.ts` — add `creatorLiveInputs`, `streamBroadcasts`; extend `streams`
- `convex/streams.ts` — refactor `goLive` + `endLivestream` to orchestrate simulcast
- `convex/http.ts` — mount webhook route
- `convex/crons.ts` — add orphan cleanup cron
- `components/studio/go-live-modal.tsx` — per-broadcast YouTube metadata fields + pre-flight confirm
- `components/studio/studio-view.tsx` — wire SimulcastStatus component
- `hooks/use-go-live.ts` — surface simulcast state

---

## Pre-requisite env vars

Before starting Task 1, the following env vars must be set both in `.env.local` and in the Convex dashboard → Settings → Environment Variables:

```bash
CLOUDFLARE_STREAM_API_TOKEN=...        # Stream:Edit + Account Settings:Read
CLOUDFLARE_ACCOUNT_ID=...              # reused
CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN=customer-xxxxxxxx.cloudflarestream.com
REALTIMEKIT_WEBHOOK_SECRET=...         # discovered during Task 0 / 8
GOOGLE_CLIENT_ID=...                   # already present
GOOGLE_CLIENT_SECRET=...               # already present
```

---

## Task 0: Verification Spike — confirm RealtimeKit RTMP-out

**Purpose:** Option A's whole architecture depends on RealtimeKit's livestream API accepting an arbitrary external RTMPS destination. Verify empirically before writing any dependent code. If this task fails, stop and pivot to Option B (not covered in this plan).

**Files:**
- Create: `scripts/verify-rtk-rtmp-out.ts`

- [ ] **Step 1: Write a throwaway Node script that creates a test meeting and starts a livestream with an external RTMP destination**

```typescript
// scripts/verify-rtk-rtmp-out.ts
// Run with: pnpm tsx scripts/verify-rtk-rtmp-out.ts
// Requires: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_REALTIMEKIT_APP_ID

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!
const apiToken = process.env.CLOUDFLARE_API_TOKEN!
const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID!
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }

async function main() {
  // 1. Create a temporary meeting
  const meetingRes = await fetch(`${base}/meetings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "rtmp-out-verify", preferred_region: "us-east-1" }),
  })
  const meeting = await meetingRes.json()
  const meetingId = (meeting.data ?? meeting.result)?.id
  if (!meetingId) throw new Error(`No meeting id: ${JSON.stringify(meeting)}`)
  console.log("meeting", meetingId)

  // 2. Attempt to start a livestream with external RTMP destination
  // Body shape per legacy Dyte docs — verify response
  const livestreamRes = await fetch(`${base}/meetings/${meetingId}/livestreams`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      destinations: [
        {
          type: "rtmp",
          url: "rtmp://example.invalid/live",
          stream_key: "verify-only",
        },
      ],
    }),
  })
  const livestreamBody = await livestreamRes.text()
  console.log("livestream status", livestreamRes.status)
  console.log("livestream body", livestreamBody)

  // 3. Cleanup
  await fetch(`${base}/meetings/${meetingId}`, { method: "DELETE", headers })
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the script and record the response verbatim**

Run: `pnpm tsx scripts/verify-rtk-rtmp-out.ts`

Expected success: `livestream status 200` or `201`, body contains a livestream id and echoes the destination. Accept any response shape (`data` or `result` wrapper) — we already parse defensively.

Expected failure modes:
- `400 "destinations not supported on this plan"` → Option A blocked. Stop.
- `404` on the endpoint → RTMP-out moved / renamed. Consult RealtimeKit dashboard before continuing.
- Success but with no echoed destination → RealtimeKit silently dropped the field. Still a blocker for Option A.

- [ ] **Step 3: Record findings in plan header**

Edit this plan file, under "Decisions locked in," add:

```markdown
- **Option A verified on $(date)**: RealtimeKit livestream POST accepts `destinations: [{ type: "rtmp", url, stream_key }]`. Response shape: <paste here>. Destination field name to use downstream: `<destinations|rtmpUrl|whatever the API actually wants>`.
```

- [ ] **Step 4: Delete the script after recording findings**

```bash
rm scripts/verify-rtk-rtmp-out.ts
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-13-youtube-simulcast.md
git commit -m "chore: verify RealtimeKit RTMP-out capability for simulcast"
```

**If Step 2 fails:** stop here. Open a discussion with Cloudflare support or pivot to Option B and rewrite this plan.

---

## Task 1: Schema additions

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Write a failing test for the new tables**

Create: `convex/__tests__/schema.simulcast.test.ts`

```typescript
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"

describe("simulcast schema", () => {
  test("can insert a creatorLiveInput record", async () => {
    const t = convexTest(schema)
    const { userId, liveInputId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        privyDid: "did:test:1",
        walletAddress: "wallet1",
      })
      const liveInputId = await ctx.db.insert("creatorLiveInputs", {
        userId,
        cloudflareLiveInputUid: "cf-li-1",
        rtmpsUrl: "rtmps://live.cloudflare.com:443/live/",
        streamKeyEncrypted: "encrypted",
        createdAt: Date.now(),
      })
      return { userId, liveInputId }
    })
    expect(liveInputId).toBeDefined()
  })

  test("can insert a streamBroadcast record", async () => {
    const t = convexTest(schema)
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:2", walletAddress: "w2" })
      const streamId = await ctx.db.insert("streams", {
        creatorId: userId,
        username: "u",
        title: "t",
        category: "Other",
        status: "live",
        viewerCount: 0,
        peakViewerCount: 0,
      })
      return ctx.db.insert("streamBroadcasts", {
        streamId,
        platform: "youtube",
        status: "pending",
        externalBroadcastId: "yt-b-1",
        externalStreamId: "yt-s-1",
        cloudflareLiveOutputUid: "cf-lo-1",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run convex/__tests__/schema.simulcast.test.ts`
Expected: failure — `creatorLiveInputs` and `streamBroadcasts` are not defined tables.

- [ ] **Step 3: Add the new tables and extend `streams` in `convex/schema.ts`**

Insert the following before the closing `})` of `defineSchema({ ... })`. Also extend the `streams` table fields.

In the `streams` table, after the `spendingApprovalSignature` field, add:

```typescript
    cloudflareStreamVideoUid: v.optional(v.string()), // Cloudflare Stream video UID for HLS playback via the Live Input
    simulcastEnabled: v.optional(v.boolean()),         // true if creator opted to simulcast this stream
```

Add two new tables before the final `})`:

```typescript
  creatorLiveInputs: defineTable({
    userId: v.id("users"),
    cloudflareLiveInputUid: v.string(),    // Stream Live Input UID
    rtmpsUrl: v.string(),                  // RTMPS ingest URL
    streamKeyEncrypted: v.string(),        // AES-256-GCM encrypted
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_cloudflare_uid", ["cloudflareLiveInputUid"]),

  streamBroadcasts: defineTable({
    streamId: v.id("streams"),
    platform: v.union(v.literal("youtube"), v.literal("x")),

    status: v.union(
      v.literal("pending"),         // created but not yet live
      v.literal("live"),             // actively broadcasting
      v.literal("degraded"),         // RTMP dropped, reconnecting
      v.literal("ended"),            // clean end
      v.literal("failed"),           // unrecoverable error
    ),

    // External platform identifiers
    externalBroadcastId: v.optional(v.string()),  // YouTube liveBroadcast.id
    externalStreamId: v.optional(v.string()),     // YouTube liveStream.id

    // Cloudflare Stream Live Output UID (the simulcast destination)
    cloudflareLiveOutputUid: v.optional(v.string()),

    // Pre-broadcast metadata (user-supplied in go-live modal)
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    privacy: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),

    // Observability
    errorMessage: v.optional(v.string()),
    degradedSince: v.optional(v.number()),   // set when status flips to "degraded"
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_stream", ["streamId"])
    .index("by_stream_and_platform", ["streamId", "platform"])
    .index("by_status", ["status"])
    .index("by_external_broadcast", ["externalBroadcastId"]),
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm exec vitest run convex/__tests__/schema.simulcast.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/__tests__/schema.simulcast.test.ts
git commit -m "feat(schema): add creatorLiveInputs and streamBroadcasts tables for simulcast"
```

---

## Task 2: Cloudflare Stream request helper

**Files:**
- Create: `lib/cloudflare-stream.ts`
- Create: `lib/__tests__/cloudflare-stream.test.ts`

**Purpose:** Single typed entry point for Cloudflare Stream REST calls. Keeps URL construction, auth, and error handling out of Convex actions.

- [ ] **Step 1: Write failing tests**

```typescript
// lib/__tests__/cloudflare-stream.test.ts
import { describe, expect, test, vi, beforeEach } from "vitest"
import { createLiveInput, addLiveOutput, deleteLiveOutput } from "../cloudflare-stream"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc"
  process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
})

describe("createLiveInput", () => {
  test("POSTs to the correct URL with auth and returns uid + stream key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            uid: "li-1",
            rtmps: { url: "rtmps://live.cloudflare.com:443/live/", streamKey: "sk-1" },
          },
          success: true,
        }),
        { status: 200 },
      ),
    )
    const result = await createLiveInput({ meta: { name: "user-123" } })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc/stream/live_inputs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    )
    expect(result).toEqual({
      uid: "li-1",
      rtmpsUrl: "rtmps://live.cloudflare.com:443/live/",
      streamKey: "sk-1",
    })
  })

  test("throws on non-2xx response with body text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: "nope" }] }), { status: 400 }),
    )
    await expect(createLiveInput({ meta: { name: "x" } })).rejects.toThrow(/400/)
  })
})

describe("addLiveOutput", () => {
  test("POSTs to /live_inputs/:uid/outputs with rtmp destination", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { uid: "lo-1" }, success: true }), { status: 200 }),
    )
    const out = await addLiveOutput({
      liveInputUid: "li-1",
      url: "rtmp://a.rtmp.youtube.com/live2",
      streamKey: "yt-key",
    })
    expect(out).toEqual({ uid: "lo-1" })
  })
})

describe("deleteLiveOutput", () => {
  test("DELETEs correct endpoint and ignores 404 (already gone)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }))
    await expect(
      deleteLiveOutput({ liveInputUid: "li-1", outputUid: "lo-1" }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm exec vitest run lib/__tests__/cloudflare-stream.test.ts`
Expected: ENOENT — file does not exist.

- [ ] **Step 3: Implement `lib/cloudflare-stream.ts`**

```typescript
// lib/cloudflare-stream.ts
// Thin typed wrapper around Cloudflare Stream REST API. Pure — no Convex imports,
// no Node-only APIs — so it can be imported from both actions and internal modules.

type CreateLiveInputArgs = {
  meta: { name: string }
  recording?: { mode: "automatic" | "off" }
}

type CreateLiveInputResult = {
  uid: string
  rtmpsUrl: string
  streamKey: string
}

type AddLiveOutputArgs = {
  liveInputUid: string
  url: string
  streamKey: string
}

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function baseUrl(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/stream`
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${env("CLOUDFLARE_STREAM_API_TOKEN")}`,
    "Content-Type": "application/json",
  }
}

async function handle<T>(res: Response, ctx: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${ctx} failed: ${res.status} — ${body}`)
  }
  const json = (await res.json()) as { result: T }
  return json.result
}

export async function createLiveInput(
  args: CreateLiveInputArgs,
): Promise<CreateLiveInputResult> {
  const res = await fetch(`${baseUrl()}/live_inputs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      meta: args.meta,
      recording: args.recording ?? { mode: "automatic" },
    }),
  })
  const result = await handle<{
    uid: string
    rtmps: { url: string; streamKey: string }
  }>(res, "createLiveInput")
  return {
    uid: result.uid,
    rtmpsUrl: result.rtmps.url,
    streamKey: result.rtmps.streamKey,
  }
}

export async function getLiveInput(liveInputUid: string) {
  const res = await fetch(`${baseUrl()}/live_inputs/${liveInputUid}`, {
    headers: headers(),
  })
  return handle<{ uid: string; status: unknown }>(res, "getLiveInput")
}

export async function addLiveOutput(args: AddLiveOutputArgs): Promise<{ uid: string }> {
  const res = await fetch(`${baseUrl()}/live_inputs/${args.liveInputUid}/outputs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      url: args.url,
      streamKey: args.streamKey,
      enabled: true,
    }),
  })
  return handle<{ uid: string }>(res, "addLiveOutput")
}

export async function deleteLiveOutput(args: {
  liveInputUid: string
  outputUid: string
}): Promise<void> {
  const res = await fetch(
    `${baseUrl()}/live_inputs/${args.liveInputUid}/outputs/${args.outputUid}`,
    { method: "DELETE", headers: headers() },
  )
  if (res.status === 404) return
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`deleteLiveOutput failed: ${res.status} — ${body}`)
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run lib/__tests__/cloudflare-stream.test.ts`
Expected: all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/cloudflare-stream.ts lib/__tests__/cloudflare-stream.test.ts
git commit -m "feat(lib): add Cloudflare Stream Live Input + Live Output request helpers"
```

---

## Task 3: Lazy per-creator Live Input provisioning

**Files:**
- Create: `convex/creatorLiveInputs.ts`
- Create: `convex/cloudflareStream.ts`
- Create: `convex/__tests__/creatorLiveInputs.test.ts`

- [ ] **Step 1: Write failing test for the mutation + query layer**

```typescript
// convex/__tests__/creatorLiveInputs.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"
import { internal } from "../_generated/api"

describe("creatorLiveInputs", () => {
  test("getForUser returns null when none exists", async () => {
    const t = convexTest(schema)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "x", walletAddress: "w" }),
    )
    const result = await t.query(internal.creatorLiveInputs.getForUser, { userId })
    expect(result).toBeNull()
  })

  test("upsertForUser inserts then overwrites on second call", async () => {
    const t = convexTest(schema)
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "x", walletAddress: "w" }),
    )
    await t.mutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: "cf-1",
      rtmpsUrl: "rtmps://a",
      streamKeyEncrypted: "enc-1",
    })
    const first = await t.query(internal.creatorLiveInputs.getForUser, { userId })
    expect(first?.cloudflareLiveInputUid).toBe("cf-1")

    await t.mutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: "cf-2",
      rtmpsUrl: "rtmps://b",
      streamKeyEncrypted: "enc-2",
    })
    const second = await t.query(internal.creatorLiveInputs.getForUser, { userId })
    expect(second?.cloudflareLiveInputUid).toBe("cf-2")
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run convex/__tests__/creatorLiveInputs.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement query + mutation layer**

```typescript
// convex/creatorLiveInputs.ts
import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"

export const getForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("creatorLiveInputs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first()
  },
})

export const upsertForUser = internalMutation({
  args: {
    userId: v.id("users"),
    cloudflareLiveInputUid: v.string(),
    rtmpsUrl: v.string(),
    streamKeyEncrypted: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creatorLiveInputs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        cloudflareLiveInputUid: args.cloudflareLiveInputUid,
        rtmpsUrl: args.rtmpsUrl,
        streamKeyEncrypted: args.streamKeyEncrypted,
        lastUsedAt: Date.now(),
      })
      return existing._id
    }
    return ctx.db.insert("creatorLiveInputs", {
      ...args,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })
  },
})

export const touchLastUsed = internalMutation({
  args: { id: v.id("creatorLiveInputs") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastUsedAt: Date.now() })
  },
})
```

- [ ] **Step 4: Implement the Convex action that ensures the Live Input exists**

```typescript
// convex/cloudflareStream.ts
"use node"

import { v } from "convex/values"
import { action, internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { encrypt, decrypt } from "./lib/tokenEncryption"
import { createLiveInput, addLiveOutput, deleteLiveOutput } from "../lib/cloudflare-stream"

// Returns the per-creator Live Input — creates one on first call, reuses thereafter.
export const ensureLiveInput = internalAction({
  args: { userId: v.id("users"), displayName: v.string() },
  handler: async (ctx, { userId, displayName }): Promise<{
    liveInputUid: string
    rtmpsUrl: string
    streamKey: string
  }> => {
    const existing = await ctx.runQuery(internal.creatorLiveInputs.getForUser, { userId })
    if (existing) {
      return {
        liveInputUid: existing.cloudflareLiveInputUid,
        rtmpsUrl: existing.rtmpsUrl,
        streamKey: decrypt(existing.streamKeyEncrypted),
      }
    }

    const created = await createLiveInput({ meta: { name: `switched-${displayName}-${userId}` } })
    await ctx.runMutation(internal.creatorLiveInputs.upsertForUser, {
      userId,
      cloudflareLiveInputUid: created.uid,
      rtmpsUrl: created.rtmpsUrl,
      streamKeyEncrypted: encrypt(created.streamKey),
    })
    return {
      liveInputUid: created.uid,
      rtmpsUrl: created.rtmpsUrl,
      streamKey: created.streamKey,
    }
  },
})

export const createSimulcastOutput = internalAction({
  args: {
    liveInputUid: v.string(),
    destinationUrl: v.string(),
    destinationStreamKey: v.string(),
  },
  handler: async (_ctx, args): Promise<{ outputUid: string }> => {
    const result = await addLiveOutput({
      liveInputUid: args.liveInputUid,
      url: args.destinationUrl,
      streamKey: args.destinationStreamKey,
    })
    return { outputUid: result.uid }
  },
})

export const removeSimulcastOutput = internalAction({
  args: { liveInputUid: v.string(), outputUid: v.string() },
  handler: async (_ctx, { liveInputUid, outputUid }): Promise<void> => {
    await deleteLiveOutput({ liveInputUid, outputUid })
  },
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run convex/__tests__/creatorLiveInputs.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add convex/creatorLiveInputs.ts convex/cloudflareStream.ts convex/__tests__/creatorLiveInputs.test.ts
git commit -m "feat(convex): lazy per-creator Cloudflare Stream Live Input provisioning"
```

---

## Task 4: streamBroadcasts CRUD

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
      creatorId: userId,
      username: "u",
      title: "t",
      category: "Other",
      status: "live",
      viewerCount: 0,
      peakViewerCount: 0,
    })
    return { userId, streamId }
  })
}

describe("streamBroadcasts", () => {
  test("create + markLive + markEnded lifecycle", async () => {
    const t = convexTest(schema)
    const { streamId } = await seed(t)

    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId,
      platform: "youtube",
      title: "My stream",
      description: "",
      privacy: "public",
    })

    await t.mutation(internal.streamBroadcasts.attachExternals, {
      id,
      externalBroadcastId: "yt-b",
      externalStreamId: "yt-s",
      cloudflareLiveOutputUid: "cf-lo",
    })

    await t.mutation(internal.streamBroadcasts.markLive, { id })
    await t.mutation(internal.streamBroadcasts.markEnded, { id })

    const record = await t.run(async (ctx) => ctx.db.get(id))
    expect(record?.status).toBe("ended")
    expect(record?.endedAt).toBeDefined()
  })

  test("markDegraded + markFailed set error metadata", async () => {
    const t = convexTest(schema)
    const { streamId } = await seed(t)
    const id = await t.mutation(internal.streamBroadcasts.create, {
      streamId, platform: "youtube", title: "x", description: "", privacy: "public",
    })

    await t.mutation(internal.streamBroadcasts.markDegraded, { id })
    const degraded = await t.run(async (ctx) => ctx.db.get(id))
    expect(degraded?.status).toBe("degraded")
    expect(degraded?.degradedSince).toBeTypeOf("number")

    await t.mutation(internal.streamBroadcasts.markFailed, { id, errorMessage: "token refresh failed" })
    const failed = await t.run(async (ctx) => ctx.db.get(id))
    expect(failed?.status).toBe("failed")
    expect(failed?.errorMessage).toBe("token refresh failed")
  })
})
```

- [ ] **Step 2: Run and verify failure**

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
    cloudflareLiveOutputUid: v.string(),
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
    const live = await ctx.db
      .query("streamBroadcasts")
      .withIndex("by_status", (q) => q.eq("status", "live"))
      .collect()
    const degraded = await ctx.db
      .query("streamBroadcasts")
      .withIndex("by_status", (q) => q.eq("status", "degraded"))
      .collect()
    return [...live, ...degraded]
  },
})
```

- [ ] **Step 4: Run and verify pass**

Run: `pnpm exec vitest run convex/__tests__/streamBroadcasts.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/streamBroadcasts.ts convex/__tests__/streamBroadcasts.test.ts
git commit -m "feat(convex): streamBroadcasts table CRUD with lifecycle transitions"
```

---

## Task 5: YouTube per-broadcast lifecycle actions

**Files:**
- Create: `convex/youtubeBroadcasts.ts`
- Create: `convex/__tests__/youtubeBroadcasts.test.ts`

**Purpose:** Wrap the YouTube Data API v3 calls (`liveStreams.insert`, `liveBroadcasts.insert`, `liveBroadcasts.bind`, `liveBroadcasts.transition`, `liveBroadcasts.delete`) in Convex internal actions. Uses existing `refreshYoutubeToken` pattern from `connectedPlatformsActions.ts`.

- [ ] **Step 1: Write failing tests**

Test strategy: mock `fetch` and verify the YouTube API is called with the right URL, method, and body shape. Error paths: token refresh failure → throw with a specific error code the orchestrator can catch.

```typescript
// convex/__tests__/youtubeBroadcasts.test.ts
import { describe, expect, test, vi, beforeEach } from "vitest"

// Note: these tests exercise the pure request-shape logic in a helper we'll
// extract. The Convex action layer (with ctx) gets integration-tested via
// goLive in Task 6.

import { buildYoutubeInsertBroadcastBody, parseYoutubeError } from "../youtubeBroadcasts"

describe("youtubeBroadcasts helpers", () => {
  test("buildYoutubeInsertBroadcastBody shapes the request body correctly", () => {
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

  test("parseYoutubeError extracts quota-exceeded signal", () => {
    const code = parseYoutubeError({
      error: { code: 403, errors: [{ reason: "quotaExceeded" }] },
    })
    expect(code).toBe("quota_exceeded")
  })

  test("parseYoutubeError extracts invalid-credentials signal", () => {
    const code = parseYoutubeError({
      error: { code: 401, errors: [{ reason: "authError" }] },
    })
    expect(code).toBe("invalid_credentials")
  })

  test("parseYoutubeError falls back to generic for unknown shapes", () => {
    expect(parseYoutubeError({ weird: true })).toBe("unknown")
  })
})
```

- [ ] **Step 2: Run and verify failure**

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
  title: string
  description: string
  privacy: Privacy
  scheduledStartTime: string
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
    broadcastId: string
    streamId: string
    rtmpUrl: string
    streamKey: string
  }> => {
    // Ensure fresh access token
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
        body: JSON.stringify(
          buildYoutubeInsertBroadcastBody({
            title: args.title,
            description: args.description,
            privacy: args.privacy,
            scheduledStartTime: new Date().toISOString(),
          }),
        ),
      },
    )
    if (!broadcastRes.ok) {
      const body = await broadcastRes.json().catch(() => ({}))
      const code = parseYoutubeError(body)
      throw new Error(`youtube.createBroadcast:${code}:${broadcastRes.status}`)
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
      return // token refresh failed — we can't clean up on YouTube's side, log and move on
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

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm exec vitest run convex/__tests__/youtubeBroadcasts.test.ts`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/youtubeBroadcasts.ts convex/__tests__/youtubeBroadcasts.test.ts
git commit -m "feat(convex): YouTube per-broadcast lifecycle actions (insert/bind/transition/delete)"
```

---

## Task 6: Refactor `goLive` to orchestrate simulcast

**Files:**
- Modify: `convex/streams.ts:627-752`
- Modify: `convex/__tests__/goLive.test.ts`

**What changes:** `goLive` now accepts an optional `simulcast` arg describing per-platform intent. When `simulcast.youtube` is present, it runs this orchestration sequence with retry + graceful-degrade per Decisions 4b/4c:

1. Ensure per-creator Cloudflare Stream Live Input exists
2. Start RealtimeKit livestream with RTMP destination = the Live Input's RTMPS URL
3. For each requested platform:
   a. `streamBroadcasts.create` (status: pending)
   b. YouTube: `createBroadcast` (retry once on non-auth errors)
   c. Cloudflare `createSimulcastOutput` (retry once)
   d. YouTube: `transitionBroadcast` → `live`
   e. `streamBroadcasts.markLive` + `attachExternals`
   f. On any failure in b-d: `streamBroadcasts.markFailed` but **do not** fail the whole go-live.

- [ ] **Step 1: Write failing integration test for happy-path YouTube simulcast**

Add to `convex/__tests__/goLive.test.ts`:

```typescript
test("goLive with simulcast.youtube creates a streamBroadcast and transitions to live", async () => {
  // Mock fetch to simulate:
  // - RealtimeKit livestream start (returns 200 + playback_url)
  // - YouTube insert broadcast (200 + id)
  // - YouTube insert stream (200 + id + cdn.ingestionInfo)
  // - YouTube bind (200)
  // - Cloudflare createLiveInput (200 — first-time creator)
  // - Cloudflare addLiveOutput (200)
  // - YouTube transition to live (200)
  //
  // Assert: streamBroadcasts has one row for the stream with status=live and
  // externalBroadcastId populated.
  // (Full fetch mock setup mirrors existing patterns in this file — see the
  // existing goLive happy-path test for the mock harness.)
})

test("goLive with simulcast.youtube graceful-degrades when YouTube insert fails twice", async () => {
  // Mock YouTube insert to 500 twice. Assert:
  // - streamBroadcasts has one row with status=failed and errorMessage populated
  // - The Switched stream itself is still marked live (playbackUrl set)
  // - The returned { streamId } is valid
})
```

- [ ] **Step 2: Modify the `goLive` signature and orchestration**

Add near the top of `convex/streams.ts`, after existing imports:

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
    // Do not retry auth-shape errors — they won't succeed on retry.
    if (/invalid_credentials|quota_exceeded/.test(msg)) throw e
    console.warn(`${label} failed once, retrying after 200ms: ${msg}`)
    await new Promise((r) => setTimeout(r, 200))
    try {
      return await fn()
    } catch (e2) {
      await new Promise((r) => setTimeout(r, 800))
      return await fn()
    }
  }
}
```

Replace the existing `goLive` args section (line 628-633) with:

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

Then, after the existing `setLive` call (around line 730) and before the `fanOutGoLiveNotifications`, insert the simulcast orchestration block:

```typescript
      // ── Simulcast orchestration ──────────────────────────────────────────
      if (simulcast?.youtube) {
        await ctx.runMutation(api.streams.setSimulcastEnabled, { id: streamId, enabled: true })

        const ytConnection = await ctx.runQuery(
          internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
          { userId, platform: "youtube" },
        )

        if (!ytConnection || ytConnection.status !== "active") {
          // 4a: pre-flight check should have blocked this, but if it somehow reaches us,
          // degrade gracefully and surface via streamBroadcasts.
          const broadcastId = await ctx.runMutation(internal.streamBroadcasts.create, {
            streamId,
            platform: "youtube",
            title: simulcast.youtube.title,
            description: simulcast.youtube.description,
            privacy: simulcast.youtube.privacy,
          })
          await ctx.runMutation(internal.streamBroadcasts.markFailed, {
            id: broadcastId,
            errorMessage: "YouTube not connected or token expired",
          })
        } else {
          const broadcastId = await ctx.runMutation(internal.streamBroadcasts.create, {
            streamId,
            platform: "youtube",
            title: simulcast.youtube.title,
            description: simulcast.youtube.description,
            privacy: simulcast.youtube.privacy,
          })

          try {
            // 1. Ensure per-creator Live Input
            const liveInput = await ctx.runAction(internal.cloudflareStream.ensureLiveInput, {
              userId,
              displayName: userRecord?.username ?? "creator",
            })

            // 2. YouTube: create broadcast + stream + bind (retry once)
            const ytResult = await withRetryOnce(
              () => ctx.runAction(internal.youtubeBroadcasts.createBroadcast, {
                connectionId: ytConnection._id,
                title: simulcast.youtube!.title,
                description: simulcast.youtube!.description,
                privacy: simulcast.youtube!.privacy,
              }),
              "youtube.createBroadcast",
            )

            // 3. Cloudflare: create Live Output pointing at YouTube RTMP (retry once)
            const output = await withRetryOnce(
              () => ctx.runAction(internal.cloudflareStream.createSimulcastOutput, {
                liveInputUid: liveInput.liveInputUid,
                destinationUrl: ytResult.rtmpUrl,
                destinationStreamKey: ytResult.streamKey,
              }),
              "cloudflare.createSimulcastOutput",
            )

            await ctx.runMutation(internal.streamBroadcasts.attachExternals, {
              id: broadcastId,
              externalBroadcastId: ytResult.broadcastId,
              externalStreamId: ytResult.streamId,
              cloudflareLiveOutputUid: output.outputUid,
            })

            // 4. Transition YouTube broadcast to live (retry once)
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

Additionally, add the `setSimulcastEnabled` mutation in `convex/streams.ts`:

```typescript
export const setSimulcastEnabled = mutation({
  args: { id: v.id("streams"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ctx.db.patch(id, { simulcastEnabled: enabled })
  },
})
```

Additionally, **modify the RealtimeKit livestream start call** (line 689-692) to include the RTMP destination pointing at the per-creator Live Input when simulcast is requested. Since `ensureLiveInput` is called later in the flow, reorder: call `ensureLiveInput` *before* the RealtimeKit livestream start when `simulcast` is truthy, and pass the RTMPS destination in the body:

```typescript
      // If simulcasting, ensure the Live Input first — we need its RTMPS URL
      // to pass as RealtimeKit's RTMP destination.
      let rtmpDestination: { url: string; streamKey: string } | null = null
      if (simulcast?.youtube) {
        const liveInput = await ctx.runAction(internal.cloudflareStream.ensureLiveInput, {
          userId,
          displayName: userRecord?.username ?? "creator",
        })
        rtmpDestination = {
          url: liveInput.rtmpsUrl,
          streamKey: liveInput.streamKey,
        }
      }

      // Start the HLS livestream on Cloudflare (RealtimeKit)
      const livestreamBody = rtmpDestination
        ? {
            destinations: [
              { type: "rtmp", url: rtmpDestination.url, stream_key: rtmpDestination.streamKey },
            ],
          }
        : {}

      const startRes = await fetch(
        `${baseUrl}/meetings/${session.cloudflareRoomId}/livestreams`,
        { method: "POST", headers, body: JSON.stringify(livestreamBody) },
      )
```

Then, in the simulcast orchestration block above, **remove** the duplicate `ensureLiveInput` call — it's now been moved earlier.

- [ ] **Step 3: Run the new tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/goLive.test.ts`
Expected: all tests including the two new ones pass.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/streams.ts convex/__tests__/goLive.test.ts
git commit -m "feat(convex): wire YouTube simulcast into goLive orchestration with graceful-degrade"
```

---

## Task 7: Refactor `endLivestream` for ordered tear-down

**Files:**
- Modify: `convex/streams.ts:791+` (`endLivestream`)
- Modify: `convex/__tests__/streams.test.ts`

**Order per Decision 4e (best-effort):**
1. For each active broadcast: YouTube `transition → complete`
2. For each active broadcast: delete the Cloudflare Simulcast Output
3. Mark each broadcast `ended`
4. Stop the RealtimeKit livestream (existing code)
5. Mark the stream `ended` (existing code)

All steps run best-effort — any failure is logged, doesn't block UI return.

- [ ] **Step 1: Write failing test**

```typescript
// convex/__tests__/streams.test.ts — add
test("endLivestream cleans up YouTube broadcast and Cloudflare output", async () => {
  // Seed: stream with one live streamBroadcast (youtube) and attached externals.
  // Mock fetch for:
  //   - YouTube transition to complete (200)
  //   - Cloudflare deleteLiveOutput (200)
  //   - RealtimeKit stop (200)
  // Run endLivestream.
  // Assert:
  //   - streamBroadcasts row is status=ended with endedAt set
  //   - stream.status = ended
  //   - fetch was called with YouTube transition URL containing broadcastStatus=complete
})

test("endLivestream survives YouTube API 500 and still marks broadcast ended locally", async () => {
  // Same seed; mock YouTube transition to 500. Assert broadcast is still
  // status=ended (local cleanup succeeded even though YouTube side didn't).
})
```

- [ ] **Step 2: Replace the existing `endLivestream` body** (lines ~791-860)

Keep the first section (auth, session lookup, env check) identical. Before the existing RealtimeKit stop call, insert:

```typescript
    // ── Simulcast tear-down (best-effort) ──────────────────────────────────
    const broadcasts = await ctx.runQuery(api.streamBroadcasts.listForStream, { streamId })
    const creatorLiveInput = await ctx.runQuery(internal.creatorLiveInputs.getForUser, { userId })

    for (const b of broadcasts) {
      if (b.status !== "live" && b.status !== "degraded") continue

      if (b.platform === "youtube" && b.externalBroadcastId) {
        const ytConnection = await ctx.runQuery(
          internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
          { userId, platform: "youtube" },
        )
        if (ytConnection) {
          try {
            await ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
              connectionId: ytConnection._id,
              broadcastId: b.externalBroadcastId,
              status: "complete",
            })
          } catch (e) {
            console.warn("YouTube transition to complete failed (best-effort):", e)
          }
        }
      }

      if (b.cloudflareLiveOutputUid && creatorLiveInput) {
        try {
          await ctx.runAction(internal.cloudflareStream.removeSimulcastOutput, {
            liveInputUid: creatorLiveInput.cloudflareLiveInputUid,
            outputUid: b.cloudflareLiveOutputUid,
          })
        } catch (e) {
          console.warn("Cloudflare Live Output delete failed (best-effort):", e)
        }
      }

      await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: b._id })
    }
    // ── End simulcast tear-down ────────────────────────────────────────────
```

Keep the existing RealtimeKit `active-livestream/stop` call and the status/billing updates below unchanged.

- [ ] **Step 3: Run and verify pass**

Run: `pnpm exec vitest run convex/__tests__/streams.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add convex/streams.ts convex/__tests__/streams.test.ts
git commit -m "feat(convex): best-effort simulcast tear-down in endLivestream"
```

---

## Task 8: RealtimeKit webhook handler

**Files:**
- Create: `convex/webhooks.ts`
- Modify: `convex/http.ts`
- Create: `convex/__tests__/webhooks.test.ts`

**Purpose (Decision 4f):** `meeting.ended` and `livestreaming.statusUpdate` trigger tear-down when the creator doesn't explicitly end the stream. Verifies HMAC-SHA256 signature per Dyte docs.

**Before implementing:** discover the webhook subscription endpoint. Try these in order (using `$CLOUDFLARE_STREAM_API_TOKEN` in headers if needed, or `$CLOUDFLARE_API_TOKEN` for RealtimeKit):

```bash
curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/realtime/kit/$CLOUDFLARE_REALTIMEKIT_APP_ID/webhooks"
```

If that 404s, check the RealtimeKit dashboard for a "Webhooks" or "Developer" section. Record the subscription URL before Step 3.

- [ ] **Step 1: Write failing test for signature verification**

```typescript
// convex/__tests__/webhooks.test.ts
import { describe, expect, test } from "vitest"
import { verifyRtkSignature } from "../webhooks"

describe("verifyRtkSignature", () => {
  test("accepts a valid signature", async () => {
    const secret = "test-secret"
    const body = JSON.stringify({ event: "meeting.ended", meeting: { id: "m-1" } })
    const sig = await computeHmac(secret, body)
    expect(await verifyRtkSignature(body, sig, secret)).toBe(true)
  })

  test("rejects a tampered body", async () => {
    const secret = "test-secret"
    const body = JSON.stringify({ event: "meeting.ended", meeting: { id: "m-1" } })
    const sig = await computeHmac(secret, body)
    const tampered = JSON.stringify({ event: "meeting.ended", meeting: { id: "m-EVIL" } })
    expect(await verifyRtkSignature(tampered, sig, secret)).toBe(false)
  })
})

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
```

- [ ] **Step 2: Run; verify failure**

Run: `pnpm exec vitest run convex/__tests__/webhooks.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement handler**

```typescript
// convex/webhooks.ts
// HTTP action for RealtimeKit webhooks. Runs on Convex's V8 isolate (NOT Node),
// so we use crypto.subtle, not node:crypto.

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
  // Constant-time compare
  if (computedHex.length !== signatureHex.length) return false
  let diff = 0
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ signatureHex.charCodeAt(i)
  }
  return diff === 0
}

type RtkWebhookPayload =
  | { event: "meeting.ended"; meeting: { id: string } }
  | { event: "meeting.started"; meeting: { id: string } }
  | { event: "livestreaming.statusUpdate"; meeting: { id: string }; livestream: { status: "LIVE" | "OFFLINE" | "IDLE" } }
  | { event: string; [k: string]: unknown }

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

  const payload = JSON.parse(rawBody) as RtkWebhookPayload
  console.log("rtkWebhook", payload.event, JSON.stringify(payload).slice(0, 500))

  if (payload.event === "meeting.ended") {
    const meetingId = (payload as { meeting: { id: string } }).meeting.id
    await ctx.runAction(internal.streams.teardownByRtkMeeting, { cloudflareRoomId: meetingId })
  }

  if (payload.event === "livestreaming.statusUpdate") {
    const p = payload as { meeting: { id: string }; livestream: { status: string } }
    if (p.livestream.status === "OFFLINE") {
      await ctx.runAction(internal.streams.markSimulcastDegradedByRtkMeeting, {
        cloudflareRoomId: p.meeting.id,
      })
    }
  }

  return new Response("ok", { status: 200 })
})
```

- [ ] **Step 4: Wire the route in `convex/http.ts`**

Replace the current contents of `convex/http.ts` with:

```typescript
import { httpRouter } from "convex/server"
import { rtkWebhook } from "./webhooks"

const http = httpRouter()

http.route({
  path: "/webhooks/rtk",
  method: "POST",
  handler: rtkWebhook,
})

export default http
```

The public URL will be `https://<your-convex-deployment>.convex.site/webhooks/rtk`. This is the URL you register with RealtimeKit when enabling webhooks (via dashboard or subscription API discovered pre-Step 3).

- [ ] **Step 5: Implement the two orchestration actions referenced by the webhook**

Add to `convex/streams.ts`:

```typescript
// ── Webhook-driven tear-down ──────────────────────────────────────────────
export const teardownByRtkMeeting = internalAction({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }): Promise<void> => {
    const session = await ctx.runQuery(internal.streams.getSessionByRoomId, { cloudflareRoomId })
    if (!session?.streamId) return
    const stream = await ctx.runQuery(api.streams.getById, { id: session.streamId })
    if (!stream || stream.status === "ended") return

    // Invoke the same tear-down path used by explicit endLivestream.
    // We do this by re-creating the orchestration inline because endLivestream
    // requires an auth identity that webhooks don't have. Extract the tear-down
    // into an internal helper shared by both paths.
    await ctx.runAction(internal.streams.performTeardown, {
      streamId: session.streamId,
      userId: stream.creatorId,
      cloudflareRoomId,
    })
  },
})

export const markSimulcastDegradedByRtkMeeting = internalAction({
  args: { cloudflareRoomId: v.string() },
  handler: async (ctx, { cloudflareRoomId }): Promise<void> => {
    const session = await ctx.runQuery(internal.streams.getSessionByRoomId, { cloudflareRoomId })
    if (!session?.streamId) return
    const broadcasts = await ctx.runQuery(api.streamBroadcasts.listForStream, { streamId: session.streamId })
    for (const b of broadcasts) {
      if (b.status === "live") {
        await ctx.runMutation(internal.streamBroadcasts.markDegraded, { id: b._id })
      }
    }
  },
})
```

Also add the `getSessionByRoomId` internalQuery and refactor the tear-down block from Task 7 into an `internal.streams.performTeardown` action, then have `endLivestream` call `performTeardown` instead of inlining the logic.

- [ ] **Step 6: Add env var to Convex dashboard**

Go to Convex dashboard → Settings → Environment Variables → add `REALTIMEKIT_WEBHOOK_SECRET`.

- [ ] **Step 7: Run tests**

Run: `pnpm exec vitest run convex/__tests__/webhooks.test.ts`
Expected: both tests pass.

- [ ] **Step 8: Commit**

```bash
git add convex/webhooks.ts convex/http.ts convex/streams.ts convex/__tests__/webhooks.test.ts
git commit -m "feat(convex): RealtimeKit webhook handler with HMAC verification and auto tear-down"
```

---

## Task 9: Orphan cleanup cron

**Files:**
- Modify: `convex/crons.ts`
- Modify: `convex/streams.ts` (add `cleanupOrphanBroadcasts` internal action)

- [ ] **Step 1: Write failing test**

```typescript
// convex/__tests__/streams.test.ts — add
test("cleanupOrphanBroadcasts marks live broadcasts on ended streams as ended", async () => {
  // Seed: stream.status = ended, one streamBroadcast with status=live
  // Run the internal action
  // Assert: broadcast.status = ended
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
        // Stream ended but this broadcast didn't — tear it down.
        await ctx.runAction(internal.streams.performTeardown, {
          streamId: stream._id,
          userId: stream.creatorId,
          cloudflareRoomId: "",  // performTeardown tolerates empty
        })
      }
      // Otherwise: broadcast degraded for >10 min → mark failed
      if (b.status === "degraded" && b.degradedSince && Date.now() - b.degradedSince > 10 * 60_000) {
        await ctx.runMutation(internal.streamBroadcasts.markFailed, {
          id: b._id,
          errorMessage: "simulcast degraded for >10m, marking failed",
        })
      }
    }
  },
})
```

In `convex/crons.ts`:

```typescript
crons.interval(
  "simulcast orphan cleanup",
  { minutes: 5 },
  internal.streams.cleanupOrphanBroadcasts,
)
```

- [ ] **Step 3: Run tests**

Run: `pnpm exec vitest run convex/__tests__/streams.test.ts`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add convex/streams.ts convex/crons.ts convex/__tests__/streams.test.ts
git commit -m "feat(convex): 5-minute cron to clean up orphan simulcast broadcasts"
```

---

## Task 10: TanStack polling for Live Input status (UI-side)

**Files:**
- Create: `lib/queries/cloudflare-stream.ts`
- Create: `app/api/cloudflare-stream/live-input/[uid]/route.ts`

**Purpose:** The studio UI needs to know when Cloudflare Stream is receiving the RTMP push (for the "Starting…" → "Live" transition visual). Convex can't see this directly — it's a Cloudflare-side state. We proxy through a Next.js route handler so we don't ship the Stream API token to the client.

- [ ] **Step 1: Create the API route**

```typescript
// app/api/cloudflare-stream/live-input/[uid]/route.ts
import { NextRequest, NextResponse } from "next/server"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN
  if (!accountId || !token) {
    return NextResponse.json({ error: "not configured" }, { status: 500 })
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return NextResponse.json({ error: "upstream" }, { status: res.status })
  const body = await res.json()
  return NextResponse.json({
    uid: body.result.uid,
    status: body.result.status,
    connected: body.result.status?.current?.state === "connected",
  })
}
```

- [ ] **Step 2: Create the TanStack query helper**

```typescript
// lib/queries/cloudflare-stream.ts
export const cloudflareStreamKeys = {
  liveInputStatus: (uid: string) => ["cloudflare-stream", "live-input", uid] as const,
}

export type LiveInputStatus = {
  uid: string
  status: unknown
  connected: boolean
}

export async function fetchLiveInputStatus(uid: string): Promise<LiveInputStatus> {
  const res = await fetch(`/api/cloudflare-stream/live-input/${uid}`)
  if (!res.ok) throw new Error(`Live Input status fetch failed: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 3: Manual smoke test**

Run the dev server: `pnpm dev`
Navigate to `http://localhost:3000/api/cloudflare-stream/live-input/<a-real-uid>`
Expected: JSON body with `connected: true|false`.

- [ ] **Step 4: Commit**

```bash
git add lib/queries/cloudflare-stream.ts app/api/cloudflare-stream/
git commit -m "feat(lib): TanStack polling + proxy route for Cloudflare Stream Live Input status"
```

---

## Task 11: Go-live modal UI — YouTube metadata + pre-flight (4a)

**Files:**
- Modify: `components/studio/go-live-modal.tsx`
- Modify: `hooks/use-go-live.ts`

**What changes:**
- When the YouTube toggle is on, show three fields below it: title (prefilled from stream title), description, privacy (public/unlisted/private).
- On submit, if YouTube is toggled on but `getPlatformByType("youtube")` returns `null` or `status !== "active"`, show a confirm dialog: "YouTube isn't connected / reconnect needed. Go live on Switched only?" with a "Reconnect" button that opens a new tab to the YouTube OAuth flow.

- [ ] **Step 1: Read the current `go-live-modal.tsx`**

```bash
# For context
```

Review `components/studio/go-live-modal.tsx` to understand the existing Destinations section and the YouTube toggle already present (from commit 4dd0aad).

- [ ] **Step 2: Add the YouTube metadata form section**

Below the existing YouTube toggle, conditionally render:

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
      <Select value={youtubePrivacy} onValueChange={(v) => setYoutubePrivacy(v as Privacy)}>
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

Add state hooks near the top of the component:

```tsx
const [youtubeTitle, setYoutubeTitle] = useState("")
const [youtubeDescription, setYoutubeDescription] = useState("")
const [youtubePrivacy, setYoutubePrivacy] = useState<Privacy>("public")
type Privacy = "public" | "unlisted" | "private"
```

- [ ] **Step 3: Add pre-flight check on submit**

Modify the go-live handler to:

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
      // User confirmed Switched-only
      await goLive({ title: streamTitle, category, simulcast: undefined })
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

`ytConnection` comes from `useQuery(api.connectedPlatforms.getPlatformByType, { platform: "youtube" })`.

- [ ] **Step 4: Update `hooks/use-go-live.ts`** to accept the `simulcast` arg and forward it to the `goLive` action.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`. Open the studio, click "Go Live." With YouTube toggle off: existing flow works. With YouTube toggle on and YouTube connected: the metadata fields render, submit kicks off simulcast. With YouTube toggle on but YouTube disconnected (simulate by running `disconnectPlatform` in Convex dashboard): confirm dialog appears.

- [ ] **Step 6: Commit**

```bash
git add components/studio/go-live-modal.tsx hooks/use-go-live.ts
git commit -m "feat(ui): YouTube metadata fields and pre-flight reconnect confirm in go-live modal"
```

---

## Task 12: SimulcastStatus component — live banner + kill-switch (4d)

**Files:**
- Create: `components/studio/simulcast-status.tsx`
- Modify: `components/studio/studio-view.tsx`

**Behavior:**
- Subscribe to `api.streamBroadcasts.listForStream` for the active stream.
- For each `live` broadcast: show a small green indicator with platform logo + "LIVE on YouTube".
- For each `degraded` broadcast: show a yellow banner "YouTube reconnecting… (XX s)".
- When `degraded` for >60s: show a "Stop YouTube simulcast" button that calls a new `api.streamBroadcasts.abandonBroadcast` action (which transitions the YouTube broadcast to `complete` and removes the Cloudflare Live Output, but leaves the Switched stream live).
- For each `failed` broadcast: show a dismissible red notice with the `errorMessage`.

- [ ] **Step 1: Add the `abandonBroadcast` action in Convex**

In `convex/streamBroadcasts.ts`, add:

```typescript
export const abandonBroadcast = action({
  args: { broadcastId: v.id("streamBroadcasts") },
  handler: async (ctx, { broadcastId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const broadcast = await ctx.runQuery(internal.streamBroadcasts.getById, { id: broadcastId })
    if (!broadcast) throw new Error("Broadcast not found")

    // Ownership check via stream creator
    const stream = await ctx.runQuery(api.streams.getById, { id: broadcast.streamId })
    const user = await ctx.runQuery(api.users.getCurrentUser, {})
    if (!user || !stream || stream.creatorId !== user._id) {
      throw new Error("Not authorized")
    }

    // Best-effort tear-down of just this platform
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
        } catch { /* best-effort */ }
      }
    }

    const liveInput = await ctx.runQuery(internal.creatorLiveInputs.getForUser, {
      userId: user._id,
    })
    if (liveInput && broadcast.cloudflareLiveOutputUid) {
      try {
        await ctx.runAction(internal.cloudflareStream.removeSimulcastOutput, {
          liveInputUid: liveInput.cloudflareLiveInputUid,
          outputUid: broadcast.cloudflareLiveOutputUid,
        })
      } catch { /* best-effort */ }
    }

    await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: broadcastId })
  },
})
```

Also add an internal `getById` query:

```typescript
export const getById = internalQuery({
  args: { id: v.id("streamBroadcasts") },
  handler: async (ctx, { id }) => ctx.db.get(id),
})
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
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => abandon({ broadcastId: b._id })}
                >
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
              <button
                className="ml-auto text-red-200 hover:text-red-100"
                onClick={() => setDismissed((s) => new Set(s).add(b._id))}
                aria-label="dismiss"
              >
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

- [ ] **Step 3: Mount it in `components/studio/studio-view.tsx`**

Find the area near the live indicator (top of the studio UI) and render `<SimulcastStatus streamId={stream._id} />` when `stream.status === "live"` and `stream.simulcastEnabled`.

- [ ] **Step 4: Manual smoke test**

Run `pnpm dev`. Simulate `degraded` by manually patching `streamBroadcasts.status` to `"degraded"` in the Convex dashboard. Verify banner appears and the "Stop simulcast" button appears after 60 s of real time.

- [ ] **Step 5: Commit**

```bash
git add components/studio/simulcast-status.tsx components/studio/studio-view.tsx convex/streamBroadcasts.ts
git commit -m "feat(ui): SimulcastStatus component with live banner and 60s kill-switch"
```

---

## Task 13: End-to-end smoke test + docs

**Files:**
- Create: `docs/features/youtube-simulcast.md`
- Create: `scripts/e2e-simulcast.md` (a manual test checklist)

- [ ] **Step 1: Write the manual E2E checklist**

```markdown
# E2E manual test — YouTube simulcast

## Prerequisites
- All env vars set in .env.local and Convex dashboard
- YouTube channel connected for the test user via /dashboard/settings/stream
- RealtimeKit app has `meeting.ended` and `livestreaming.statusUpdate` webhooks subscribed

## Happy path
1. Open studio as creator A, start meeting
2. Click "Go Live"
3. Toggle YouTube ON
4. Fill YouTube title = "Simulcast smoke test"
5. Privacy: unlisted
6. Click Go Live
7. Verify within 30s: Switched stream shows as LIVE, SimulcastStatus shows "LIVE on YouTube"
8. Open YouTube Studio → Live Dashboard → confirm broadcast is live
9. Click End Stream
10. Verify: SimulcastStatus disappears, YouTube broadcast transitions to "ended" in YouTube Studio

## Graceful degrade — YouTube auth expired
1. In Convex dashboard, patch your YouTube connection to status = "expired"
2. Open studio, toggle YouTube, click Go Live
3. Expected: confirm dialog, click OK
4. Switched goes live, streamBroadcasts row for YouTube has status=failed

## Unexpected end — browser crash
1. Start simulcast as in Happy Path
2. Force-close the browser tab
3. Within 2 min, cron should fire cleanup
4. Check Convex: stream.status = ended, streamBroadcasts.status = ended
5. Check YouTube Studio: broadcast no longer live
```

- [ ] **Step 2: Run the full checklist in a real environment**

Record results in `docs/features/youtube-simulcast.md` under a "Verified runs" section with dates.

- [ ] **Step 3: Commit**

```bash
git add docs/features/youtube-simulcast.md scripts/e2e-simulcast.md
git commit -m "docs: E2E checklist + feature notes for YouTube simulcast"
```

---

## Self-review summary

**Spec coverage:** All locked-in decisions (Option A, per-creator Live Input, per-broadcast YouTube, 4a-g) map to specific tasks: 4a → Task 11, 4b/4c → Task 6 retry helper, 4d → Task 12, 4e → Task 7, 4f → Tasks 8-9, 4g → Task 6 error propagation via `parseYoutubeError`.

**Open items (non-blocking, narrow):**
- Task 0 verifies RealtimeKit RTMP-out; if it fails, pivot required.
- Task 8 Step 3 requires empirical discovery of the webhook subscription endpoint — a 5-minute probe.
- Task 11 Step 4 assumes `hooks/use-go-live.ts` surface; minor shape may differ in implementation.

**Type consistency:** `streamBroadcasts` fields (`externalBroadcastId`, `externalStreamId`, `cloudflareLiveOutputUid`) are used identically across Tasks 1, 4, 6, 7, 8, 9, 12. `creatorLiveInputs.cloudflareLiveInputUid` used identically across Tasks 1, 3, 7, 12. Mutation names (`markLive`, `markDegraded`, `markEnded`, `markFailed`, `attachExternals`) consistent.
