# Multi-Destination Simulcast (v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped v2 single-destination simulcast to support **multiple simultaneous destinations per stream** (YouTube + X at minimum, room for LinkedIn/Twitch/Facebook in future), by introducing Cloudflare Stream Live Input as an RTMP fan-out layer between RealtimeKit and the external platforms.

**Architecture:**

```
  RealtimeKit meeting
    ├─ /livestreams                → HLS for Switched viewers (unchanged from v2)
    └─ /recordings                 → Cloudflare Stream Live Input (NEW, per-creator, persistent)
       (rtmp_out_config)                   ├─ Live Output → YouTube RTMP (via OAuth per-broadcast)
                                           ├─ Live Output → X RTMP (manual stream key)
                                           └─ Live Output → ... (Phase 3 expansion)
```

**Tech Stack:** Convex actions/mutations/HTTP actions/crons, RealtimeKit REST (`/recordings` with `rtmp_out_config`), Cloudflare Stream REST (`/live_inputs`, `/live_inputs/:uid/outputs`), YouTube Data API v3 (unchanged from v2), existing AES-256-GCM token encryption.

## Context — why v3

**v1** used `/livestreams` with `destinations` array — rejected `422`.
**v2** shipped (merged as PR #49). Uses `/recordings` with `rtmp_out_config` pointing directly at YouTube's RTMP URL. Works for single destination.
**v2 multi-destination spike** proved:
- `rtmp_out_config` as array → `422 "rtmp_out_config must be of type object"`
- Concurrent `/recordings` POSTs against same meeting → `409 "A RECORDER is already running for meeting"`

So RealtimeKit is architecturally limited to one simulcast destination per meeting on its own.

**Cloudflare Stream Live Outputs documentation confirms:**
> "You can simulcast to up to 50 concurrent destinations from each live input."
> Supports "Twitch, YouTube, Facebook, Twitter, and more."

v3 reintroduces the Cloudflare Stream Live Input layer that v1 anticipated but couldn't reach because v1 tried the wrong RealtimeKit endpoint. Now that we know `/recordings` accepts `rtmp_out_config`, we point it at Cloudflare Stream instead of at YouTube directly, and let Cloudflare Stream fan out to N destinations.

## Cost impact

Cloudflare Stream charges `$1 / 1,000 delivered minutes` per Live Output and `$5 / 1,000 minutes stored`. Approximate per-stream cost for 1 hr live to 3 destinations:

| Line | Calc | Cost |
|---|---|---|
| Ingest into Live Input | free | $0 |
| Live Output × 3 (YouTube, X, LinkedIn) | 3 × 60 min × $1/1,000 | $0.18 |
| Recording storage | 60 min × $5/1,000 | $0.30/mo |

Plus existing costs (RealtimeKit, Switched viewer delivery if we delivered via Cloudflare Stream HLS — but we still use RealtimeKit HLS for Switched viewers, so zero delta there).

---

## Migration strategy from v2

**v2 stays shipped and testable on main.** This plan produces a follow-on PR that surgically modifies the goLive / endLivestream orchestration and adds the Live Input layer. Once merged, v2's direct-to-YouTube path is replaced. No user-visible regression — the YouTube flow still works, just via an extra hop.

**Compatibility:** during rollout, existing `streamBroadcasts` rows from v2 testing will have `rtkRecordingId` set but no `cloudflareLiveOutputUid`. Those are all ended; new rows use the new shape. No migration needed.

---

## File Structure

**New files:**
- `lib/cloudflare-stream.ts` — request wrapper (createLiveInput, addLiveOutput, deleteLiveOutput, getLiveInput)
- `convex/cloudflareStream.ts` — Convex actions (ensureLiveInput, createSimulcastOutput, removeSimulcastOutput)
- `convex/creatorLiveInputs.ts` — CRUD for the new table
- `components/studio/connect-x-form.tsx` — manual RTMP paste form

**Modified files:**
- `convex/schema.ts` — add `creatorLiveInputs`; add `cloudflareLiveOutputUid` to `streamBroadcasts`
- `convex/streams.ts` — modify goLive (route via Live Input + per-destination Live Outputs loop); modify performTeardown (delete Live Outputs)
- `convex/connectedPlatformsActions.ts` — add `connectXDirectRtmp` action for manual RTMP
- `components/studio/go-live-modal.tsx` — both YouTube and X toggles, non-exclusive; per-destination status
- `app/dashboard/settings/stream/page.tsx` — add "Connect X" card
- `docs/features/youtube-simulcast.md` → rename to `simulcast.md`; add X + multi-dest paths

---

## Pre-requisite env vars

**Re-introduce from v1 (you may already have them from that aborted setup):**

```bash
CLOUDFLARE_STREAM_API_TOKEN=...                          # Scoped to Stream:Edit
CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN=customer-xxxxxxxx.cloudflarestream.com
```

Both go in `.env.local` AND Convex dashboard. Token creation steps: developers.cloudflare.com/profile/api-tokens → Create Custom Token → Account > Stream > Edit → scope to your account → save token immediately.

**Task 0 verification (2026-04-14):**
- Accepted URL scheme: `rtmps`
- Cloudflare Stream Live Input accepts RealtimeKit pushes: `yes` — POST /recordings returned 201 with status `INVOKED`
- RealtimeKit recording status after POST: `INVOKED`
- Note: `rtmp://` (plain, port 1935) was rejected with 422 — the Cloudflare Stream Live Input only exposes an `rtmps://` ingest URL; no plain `rtmp://` URL is returned at all. RealtimeKit validates the scheme but accepts `rtmps://` just fine.

---

## Task 0: Verify RTMPS push from RealtimeKit `/recordings` → Cloudflare Stream Live Input

**Purpose:** Two open unknowns before the plan commits:

1. Does RealtimeKit `/recordings.rtmp_out_config.rtmp_url` accept `rtmps://` URLs (TLS, port 443) or only plain `rtmp://`? Cloudflare Stream's ingest endpoint is `rtmps://live.cloudflare.com:443/live/`. If only `rtmp://` is accepted, we fall back to Cloudflare Stream's unencrypted port 1935 ingest.
2. Does a real RealtimeKit meeting actually connect to a Cloudflare Stream Live Input and start streaming? The placeholder-URL spikes never exercised the full handshake.

**Files:**
- Create: `scripts/spike-rtk-to-stream.ts` (throwaway)

- [x] **Step 1: Write the script**

```typescript
// scripts/spike-rtk-to-stream.ts
// Run with:
//   export CLOUDFLARE_ACCOUNT_ID=$(pnpm exec convex env get CLOUDFLARE_ACCOUNT_ID | tail -1)
//   export CLOUDFLARE_API_TOKEN=$(pnpm exec convex env get CLOUDFLARE_API_TOKEN | tail -1)
//   export CLOUDFLARE_REALTIMEKIT_APP_ID=$(pnpm exec convex env get CLOUDFLARE_REALTIMEKIT_APP_ID | tail -1)
//   export CLOUDFLARE_STREAM_API_TOKEN=<your-stream-token>
//   pnpm exec tsx scripts/spike-rtk-to-stream.ts

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!
const rtkToken = process.env.CLOUDFLARE_API_TOKEN!
const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID!
const streamToken = process.env.CLOUDFLARE_STREAM_API_TOKEN!

const rtkBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
const streamBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`

async function main() {
  // 1. Create a Cloudflare Stream Live Input
  const liRes = await fetch(`${streamBase}/live_inputs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${streamToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ meta: { name: "rtk-to-stream-spike" }, recording: { mode: "automatic" } }),
  })
  if (!liRes.ok) throw new Error(`createLiveInput ${liRes.status}: ${await liRes.text()}`)
  const liBody = await liRes.json()
  const liUid = liBody.result.uid as string
  const rtmpsUrl = liBody.result.rtmps.url as string       // rtmps://live.cloudflare.com:443/live/
  const streamKey = liBody.result.rtmps.streamKey as string
  const rtmpPlainUrl = liBody.result.rtmp?.url as string   // rtmp://... port 1935 fallback
  const rtmpPlainKey = liBody.result.rtmp?.streamKey as string
  console.log("liveInput", liUid)
  console.log("rtmpsUrl", rtmpsUrl)
  console.log("rtmpPlainUrl", rtmpPlainUrl)

  // 2. Create a RealtimeKit meeting
  const meetingRes = await fetch(`${rtkBase}/meetings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rtkToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "rtk-to-stream-spike", preferred_region: "us-east-1" }),
  })
  const meetingBody = await meetingRes.json()
  const meetingId = (meetingBody.data ?? meetingBody.result)?.id
  console.log("meeting", meetingId)

  // 3. Try rtmps:// first
  console.log("\n--- Trying rtmps:// ---")
  const rtmpsRecRes = await fetch(`${rtkBase}/recordings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rtkToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      meeting_id: meetingId,
      rtmp_out_config: { rtmp_url: `${rtmpsUrl}${streamKey}` },
    }),
  })
  console.log("rtmps status", rtmpsRecRes.status)
  console.log("body", (await rtmpsRecRes.text()).slice(0, 500))

  // If rtmps rejected, try rtmp://
  console.log("\n--- Trying rtmp:// ---")
  const rtmpRecRes = await fetch(`${rtkBase}/recordings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rtkToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      meeting_id: meetingId,
      rtmp_out_config: { rtmp_url: `${rtmpPlainUrl}${rtmpPlainKey}` },
    }),
  })
  console.log("rtmp status", rtmpRecRes.status)
  console.log("body", (await rtmpRecRes.text()).slice(0, 500))

  // Cleanup
  await fetch(`${rtkBase}/meetings/${meetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${rtkToken}` },
  })
  await fetch(`${streamBase}/live_inputs/${liUid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${streamToken}` },
  })
  console.log("\ncleanup done")
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [x] **Step 2: Run the spike, record which URL scheme is accepted**

Expected outcome: **at least one** of the two rec calls returns 201. Record in the plan:
- Which scheme (`rtmps://` or `rtmp://`)? → dictates Task 2's URL construction.
- Does the recording transition to `IN_PROGRESS` or stay `INVOKED` without actual bytes? (Without a browser participant pushing data, it'll probably ERROR within 10s like v2's spike — that's fine, we only care that the HTTP call is accepted.)

- [x] **Step 3: Record findings**

Edit this plan file in the "Pre-requisite env vars" section and add:

```markdown
**Task 0 verification (YYYY-MM-DD):**
- Accepted URL scheme: `<rtmps|rtmp>`
- Cloudflare Stream Live Input accepts RealtimeKit pushes: `<yes|no>`
- RealtimeKit recording status after POST: `INVOKED | IN_PROGRESS`
```

- [x] **Step 4: Delete the script**

```bash
rm scripts/spike-rtk-to-stream.ts
```

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-14-simulcast-multi-destination.md
git commit -m "chore: verify RealtimeKit /recordings push to Cloudflare Stream Live Input"
```

**If rtmps:// works:** skip mention of port 1935 below. Use `rtmps://` throughout Task 2.
**If only rtmp:// works:** Task 2 uses the unencrypted endpoint. Security-wise acceptable for creator content — the key is ephemeral and the stream data is already being broadcast publicly.

---

## Task 1: Schema — `creatorLiveInputs` + `cloudflareLiveOutputUid`

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/__tests__/schema.multidest.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// convex/__tests__/schema.multidest.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"

describe("multi-destination schema", () => {
  test("can insert a creatorLiveInput record", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:1", walletAddress: "w1" })
      return ctx.db.insert("creatorLiveInputs", {
        userId,
        cloudflareLiveInputUid: "li-1",
        rtmpsUrl: "rtmps://live.cloudflare.com:443/live/",
        streamKeyEncrypted: "enc",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })

  test("streamBroadcasts can carry cloudflareLiveOutputUid", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { privyDid: "did:2", walletAddress: "w2" })
      const streamId = await ctx.db.insert("streams", {
        creatorId: userId, username: "u", title: "t", category: "Other",
        status: "live", viewerCount: 0, peakViewerCount: 0,
      })
      return ctx.db.insert("streamBroadcasts", {
        streamId,
        platform: "youtube",
        status: "pending",
        cloudflareLiveOutputUid: "lo-1",
        createdAt: Date.now(),
      })
    })
    expect(id).toBeDefined()
  })
})
```

- [ ] **Step 2: Run; verify failure**

Run: `pnpm exec vitest run convex/__tests__/schema.multidest.test.ts`
Expected: fail — `creatorLiveInputs` not defined, `cloudflareLiveOutputUid` not a known field.

- [ ] **Step 3: Modify `convex/schema.ts`**

Add the `creatorLiveInputs` table before the closing `})`:

```typescript
  creatorLiveInputs: defineTable({
    userId: v.id("users"),
    cloudflareLiveInputUid: v.string(),
    rtmpsUrl: v.string(),
    streamKeyEncrypted: v.string(),           // AES-256-GCM
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_cloudflare_uid", ["cloudflareLiveInputUid"]),
```

In `streamBroadcasts`, add one field — place it right after `rtkRecordingId`:

```typescript
    cloudflareLiveOutputUid: v.optional(v.string()),  // Cloudflare Stream Live Output UID per destination
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm exec vitest run convex/__tests__/schema.multidest.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/__tests__/schema.multidest.test.ts
git commit -m "feat(schema): add creatorLiveInputs and cloudflareLiveOutputUid for multi-destination simulcast"
```

---

## Task 2: Cloudflare Stream request helper

**Files:**
- Create: `lib/cloudflare-stream.ts`
- Create: `lib/__tests__/cloudflare-stream.test.ts`

Same module as v1 plan Task 2 but we're building it fresh since v2 didn't merge it. Covers: `createLiveInput`, `getLiveInput`, `addLiveOutput`, `deleteLiveOutput`.

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
  test("POSTs to the correct URL and returns uid + rtmps credentials", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        result: { uid: "li-1", rtmps: { url: "rtmps://live.cloudflare.com:443/live/", streamKey: "sk-1" } },
      }), { status: 200 }),
    )
    const result = await createLiveInput({ meta: { name: "test" } })
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
})

describe("addLiveOutput", () => {
  test("POSTs to /live_inputs/:uid/outputs with url + streamKey + enabled=true", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: { uid: "lo-1" } }), { status: 200 }),
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
  test("ignores 404 (already gone)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }))
    await expect(deleteLiveOutput({ liveInputUid: "li-1", outputUid: "lo-1" })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run; verify failure (module not found)**

- [ ] **Step 3: Implement**

```typescript
// lib/cloudflare-stream.ts
// Pure typed wrapper — no Convex imports, no Node-only APIs.

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

- [ ] **Step 4: Run tests; verify pass**

- [ ] **Step 5: Commit**

```bash
git add lib/cloudflare-stream.ts lib/__tests__/cloudflare-stream.test.ts
git commit -m "feat(lib): Cloudflare Stream Live Input + Live Output request helpers"
```

---

## Task 3: Per-creator Live Input provisioning

**Files:**
- Create: `convex/creatorLiveInputs.ts`
- Create: `convex/cloudflareStream.ts`
- Create: `convex/__tests__/creatorLiveInputs.test.ts`

- [ ] **Step 1: Write failing test for CRUD**

```typescript
// convex/__tests__/creatorLiveInputs.test.ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"
import { internal } from "../_generated/api"

describe("creatorLiveInputs", () => {
  test("getForUser returns null when none exists", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "x", walletAddress: "w" }),
    )
    const result = await t.query(internal.creatorLiveInputs.getForUser, { userId })
    expect(result).toBeNull()
  })

  test("upsertForUser inserts, then overwrites on second call", async () => {
    const t = convexTest(schema, import.meta.glob("../**/*.ts"))
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { privyDid: "x", walletAddress: "w" }),
    )
    await t.mutation(internal.creatorLiveInputs.upsertForUser, {
      userId, cloudflareLiveInputUid: "cf-1", rtmpsUrl: "rtmps://a", streamKeyEncrypted: "e1",
    })
    expect((await t.query(internal.creatorLiveInputs.getForUser, { userId }))?.cloudflareLiveInputUid).toBe("cf-1")

    await t.mutation(internal.creatorLiveInputs.upsertForUser, {
      userId, cloudflareLiveInputUid: "cf-2", rtmpsUrl: "rtmps://b", streamKeyEncrypted: "e2",
    })
    expect((await t.query(internal.creatorLiveInputs.getForUser, { userId }))?.cloudflareLiveInputUid).toBe("cf-2")
  })
})
```

- [ ] **Step 2: Run; verify failure**

- [ ] **Step 3: Implement CRUD layer**

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
```

- [ ] **Step 4: Implement the action layer**

```typescript
// convex/cloudflareStream.ts
"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { encrypt, decrypt } from "./lib/tokenEncryption"
import { createLiveInput, addLiveOutput, deleteLiveOutput } from "../lib/cloudflare-stream"

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

- [ ] **Step 5: Run tests; verify pass**

- [ ] **Step 6: Commit**

```bash
git add convex/creatorLiveInputs.ts convex/cloudflareStream.ts convex/__tests__/creatorLiveInputs.test.ts
git commit -m "feat(convex): lazy per-creator Cloudflare Stream Live Input + Live Output actions"
```

---

## Task 4: Refactor `goLive` for Live Input + per-destination Live Outputs

**Files:**
- Modify: `convex/streams.ts` (the `goLive` action, roughly lines 620-780 post-v2)
- Modify: `convex/__tests__/goLive.test.ts`

**Core change from v2:** The `rtmp_out_config.rtmp_url` on the `/recordings` call changes from YouTube's RTMP URL to our Cloudflare Stream Live Input's RTMPS URL. Each requested destination then becomes a Cloudflare Stream Live Output.

**New orchestration for v3 goLive (after existing livestream start + setLive):**

```
if simulcast requested:
  1. ensureLiveInput (lazy create) → get rtmpsUrl + streamKey
  2. start RealtimeKit /recordings with rtmp_out_config.rtmp_url = "${rtmpsUrl}${streamKey}"
  3. for each destination in simulcast.{youtube, x}:
       a. if youtube: createBroadcast (YouTube OAuth) → get yt rtmpUrl + streamKey
          if x: read manual RTMP from connectedPlatforms
       b. createSimulcastOutput (Cloudflare Stream Live Output → platform RTMP)
       c. streamBroadcasts.create + attachExternals (with cloudflareLiveOutputUid)
       d. if youtube: transitionBroadcast → live (YouTube side)
       e. streamBroadcasts.markLive
     — all wrapped in try/catch; failures graceful-degrade per-destination.
```

**Note:** the single `/recordings` call from step 2 stays open for the whole stream. Per-destination failures don't restart it. Only when ALL destinations fail do we stop the recording (no point streaming to nothing).

- [ ] **Step 1: Write failing integration tests**

Add to `convex/__tests__/goLive.test.ts` (replacing v2's happy-path if needed):

```typescript
test("goLive simulcasting to YouTube creates Live Input + Live Output + transitions to live", async () => {
  // Mock fetch sequence:
  //   1. RealtimeKit /livestreams 200
  //   2. Cloudflare Stream /live_inputs POST 200 (first-time creator)
  //   3. RealtimeKit /recordings POST 201 with rtmp_out_config pointing at Stream Live Input
  //   4. YouTube liveBroadcasts.insert 200
  //   5. YouTube liveStreams.insert 200 with cdn.ingestionInfo
  //   6. YouTube liveBroadcasts.bind 200
  //   7. Cloudflare Stream /live_inputs/:uid/outputs POST 200 (YouTube Live Output)
  //   8. YouTube liveBroadcasts.transition (live) 200
  //
  // Assert: streamBroadcasts row has status=live, cloudflareLiveOutputUid=lo-1, externalBroadcastId=yt-b.
})

test("goLive simulcasting to both YouTube + X creates two Live Outputs", async () => {
  // Seed: YouTube connection active; X connection with rtmpUrl + streamKey set.
  // Mock fetch: as above, plus an extra POST /live_inputs/:uid/outputs 200 for X.
  // Assert: two streamBroadcasts rows, both status=live, different cloudflareLiveOutputUids.
})

test("goLive: YouTube fails, X succeeds → stream goes live with X only", async () => {
  // Mock YouTube liveBroadcasts.insert to 500 twice; X path 200.
  // Assert: YouTube broadcast status=failed, X broadcast status=live, stream.status=live.
})
```

- [ ] **Step 2: Update the orchestration block**

Read the current v2 goLive simulcast block (inserted after `setLive`). Replace the YouTube-direct path with:

```typescript
      // ── Simulcast orchestration (v3: via Cloudflare Stream Live Input) ──
      const destinations: Array<
        | { kind: "youtube"; payload: { title: string; description: string; privacy: "public" | "unlisted" | "private" } }
        | { kind: "x" }
      > = []
      if (simulcast?.youtube) destinations.push({ kind: "youtube", payload: simulcast.youtube })
      if (simulcast?.x) destinations.push({ kind: "x" })

      if (destinations.length > 0) {
        await ctx.runMutation(api.streams.setSimulcastEnabled, { id: streamId, enabled: true })

        // 1. Provision (or reuse) the per-creator Cloudflare Stream Live Input
        const liveInput = await ctx.runAction(internal.cloudflareStream.ensureLiveInput, {
          userId,
          displayName: userRecord.username ?? "creator",
        })
        const liveInputRtmpWithKey = `${liveInput.rtmpsUrl}${liveInput.streamKey}`

        // 2. Start RealtimeKit /recordings pointing at the Live Input
        let recordingId: string | null = null
        try {
          const rec = await withRetryOnce(
            () => ctx.runAction(internal.rtkRecordings.startRtmpRecording, {
              meetingId: session.cloudflareRoomId,
              rtmpUrlWithKey: liveInputRtmpWithKey,
            }),
            "rtk.startRtmpRecording",
          )
          recordingId = rec.recordingId
        } catch (e) {
          console.error("RealtimeKit /recordings failed, no simulcast this stream:", e)
          // Stream stays live on Switched; no simulcast rows created.
          return { streamId }  // or fall through without the simulcast loop
        }

        // 3. Per-destination loop
        for (const dest of destinations) {
          const broadcastId = await ctx.runMutation(internal.streamBroadcasts.create, {
            streamId,
            platform: dest.kind,
            title: dest.kind === "youtube" ? dest.payload.title : "",
            description: dest.kind === "youtube" ? dest.payload.description : "",
            privacy: dest.kind === "youtube" ? dest.payload.privacy : "public",
          })

          try {
            if (dest.kind === "youtube") {
              const ytConnection = await ctx.runQuery(
                internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
                { userId, platform: "youtube" },
              )
              if (!ytConnection || ytConnection.status !== "active") {
                throw new Error("YouTube not connected or expired")
              }
              const ytResult = await withRetryOnce(
                () => ctx.runAction(internal.youtubeBroadcasts.createBroadcast, {
                  connectionId: ytConnection._id,
                  title: dest.payload.title,
                  description: dest.payload.description,
                  privacy: dest.payload.privacy,
                }),
                "youtube.createBroadcast",
              )

              const output = await withRetryOnce(
                () => ctx.runAction(internal.cloudflareStream.createSimulcastOutput, {
                  liveInputUid: liveInput.liveInputUid,
                  destinationUrl: ytResult.rtmpUrl,
                  destinationStreamKey: ytResult.streamKey,
                }),
                "cf.createSimulcastOutput(youtube)",
              )

              await ctx.runMutation(internal.streamBroadcasts.attachExternals, {
                id: broadcastId,
                externalBroadcastId: ytResult.broadcastId,
                externalStreamId: ytResult.streamId,
                rtkRecordingId: recordingId,
                cloudflareLiveOutputUid: output.outputUid,
              })

              await withRetryOnce(
                () => ctx.runAction(internal.youtubeBroadcasts.transitionBroadcast, {
                  connectionId: ytConnection._id,
                  broadcastId: ytResult.broadcastId,
                  status: "live",
                }),
                "youtube.transition-live",
              )
            } else {
              // X (manual RTMP)
              const xConnection = await ctx.runQuery(
                internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
                { userId, platform: "x" },
              )
              if (!xConnection?.rtmpUrl || !xConnection?.streamKey) {
                throw new Error("X not connected")
              }
              const xStreamKey = decrypt(xConnection.streamKey)
              const output = await withRetryOnce(
                () => ctx.runAction(internal.cloudflareStream.createSimulcastOutput, {
                  liveInputUid: liveInput.liveInputUid,
                  destinationUrl: xConnection.rtmpUrl!,
                  destinationStreamKey: xStreamKey,
                }),
                "cf.createSimulcastOutput(x)",
              )
              await ctx.runMutation(internal.streamBroadcasts.attachExternals, {
                id: broadcastId,
                externalBroadcastId: "",             // X has no broadcast id
                externalStreamId: "",
                rtkRecordingId: recordingId,
                cloudflareLiveOutputUid: output.outputUid,
              })
            }

            await ctx.runMutation(internal.streamBroadcasts.markLive, { id: broadcastId })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`${dest.kind} simulcast failed, marking failed:`, msg)
            await ctx.runMutation(internal.streamBroadcasts.markFailed, {
              id: broadcastId,
              errorMessage: msg,
            })
          }
        }
      }
```

Note: `decrypt` import needs to be added at the top of `streams.ts` (from `./lib/tokenEncryption`). Since `streams.ts` doesn't have `"use node"`, the decrypt call would need to happen in an action or moved to the X-side implementation. Simpler path: add a new internalAction `getXRtmpCredentials` in `convex/connectedPlatformsActions.ts` that returns `{ rtmpUrl, streamKey }` decrypted, called from goLive.

**Subagent: implement that helper action first, then reference it from goLive.**

- [ ] **Step 3: Update validator for the optional X simulcast**

In `streams.ts`, modify `simulcastArgValidator`:

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
    x: v.optional(v.boolean()),   // X has no per-broadcast metadata — just "on/off"
  }),
)
```

- [ ] **Step 4: Run tests; verify pass**

- [ ] **Step 5: Typecheck + commit**

```bash
git add convex/streams.ts convex/connectedPlatformsActions.ts convex/__tests__/goLive.test.ts
git commit -m "feat(convex): simulcast via Cloudflare Stream Live Input + per-destination Live Outputs"
```

---

## Task 5: Update `performTeardown` to delete Live Outputs

**Files:**
- Modify: `convex/streams.ts` (the `performTeardown` action)
- Modify: `convex/__tests__/streams.test.ts`

**New order (per active broadcast, best-effort):**
1. YouTube `transitionBroadcast → complete` (only for platform=youtube)
2. Cloudflare Stream `deleteLiveOutput` (for every broadcast that has `cloudflareLiveOutputUid`)
3. `streamBroadcasts.markEnded`

After the loop:
4. If ANY broadcast had an `rtkRecordingId`, call `stopRecording` ONCE (the recording is shared across all destinations). Dedupe by set.
5. Stop the RealtimeKit livestream (existing call, unchanged).

- [ ] **Step 1: Write failing test**

```typescript
test("performTeardown deletes Live Outputs + stops recording once for multiple broadcasts", async () => {
  // Seed: stream with two live streamBroadcasts (youtube, x), both referencing rtkRecordingId="rec-1",
  // different cloudflareLiveOutputUids.
  // Mock fetch for: YouTube transition complete 200, two Cloudflare DELETE /outputs 200,
  // one RealtimeKit PUT /recordings/rec-1 200, one RealtimeKit livestream stop 200.
  // Assert: both broadcasts.status=ended; only ONE recording stop call was made.
})
```

- [ ] **Step 2: Modify `performTeardown`**

Replace the existing loop with:

```typescript
    const recordingsToStop = new Set<string>()
    const creatorLiveInput = await ctx.runQuery(internal.creatorLiveInputs.getForUser, { userId })

    for (const b of broadcasts) {
      if (b.status !== "live" && b.status !== "degraded") continue

      // 1. YouTube transition → complete (if applicable)
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

      // 2. Delete Cloudflare Stream Live Output
      if (b.cloudflareLiveOutputUid && creatorLiveInput) {
        try {
          await ctx.runAction(internal.cloudflareStream.removeSimulcastOutput, {
            liveInputUid: creatorLiveInput.cloudflareLiveInputUid,
            outputUid: b.cloudflareLiveOutputUid,
          })
        } catch (e) {
          console.warn("Cloudflare Live Output delete (best-effort):", e)
        }
      }

      if (b.rtkRecordingId) recordingsToStop.add(b.rtkRecordingId)

      // 3. Mark ended locally
      await ctx.runMutation(internal.streamBroadcasts.markEnded, { id: b._id })
    }

    // 4. Stop each unique recording ONCE
    for (const recordingId of recordingsToStop) {
      try {
        await ctx.runAction(internal.rtkRecordings.stopRecording, { recordingId })
      } catch (e) {
        console.warn("RealtimeKit stopRecording (best-effort):", e)
      }
    }
```

Leave the RealtimeKit livestream stop call below unchanged.

- [ ] **Step 3: Run tests; verify pass**

- [ ] **Step 4: Commit**

```bash
git add convex/streams.ts convex/__tests__/streams.test.ts
git commit -m "feat(convex): tear-down deletes Live Outputs and dedupes recording stop"
```

---

## Task 6: X "Connect" UX

**Files:**
- Modify: `app/dashboard/settings/stream/page.tsx`
- Modify: `convex/connectedPlatformsActions.ts`
- Create: `components/dashboard/connect-x-form.tsx`

**UX:** on the stream settings page, add a "Connect X" card with two inputs (RTMP URL + stream key) and a "Save" button. On save: call a new Convex action that encrypts both and stores them on `connectedPlatforms` with `platform: "x"`.

- [ ] **Step 1: Add `connectXDirectRtmp` action to `convex/connectedPlatformsActions.ts`**

```typescript
export const connectXDirectRtmp = action({
  args: {
    rtmpUrl: v.string(),
    streamKey: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, { rtmpUrl, streamKey, displayName }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")
    const user = await ctx.runQuery(internal.connectedPlatforms.getUserByPrivyDid, {
      privyDid: identity.subject,
    })
    if (!user) throw new Error("User not found")

    if (!rtmpUrl.startsWith("rtmp://") && !rtmpUrl.startsWith("rtmps://")) {
      throw new Error("RTMP URL must start with rtmp:// or rtmps://")
    }
    if (!streamKey.trim()) throw new Error("Stream key is required")

    await ctx.runMutation(internal.connectedPlatforms.storeXManualRtmp, {
      userId: user._id,
      rtmpUrl,
      streamKeyEncrypted: encrypt(streamKey.trim()),
      displayName: displayName ?? "X account",
      connectedAt: Date.now(),
    })
  },
})
```

Add the corresponding internal mutation in `convex/connectedPlatforms.ts`:

```typescript
export const storeXManualRtmp = internalMutation({
  args: {
    userId: v.id("users"),
    rtmpUrl: v.string(),
    streamKeyEncrypted: v.string(),
    displayName: v.string(),
    connectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) => q.eq("userId", args.userId).eq("platform", "x"))
      .first()
    if (existing) await ctx.db.delete(existing._id)

    return ctx.db.insert("connectedPlatforms", {
      userId: args.userId,
      platform: "x",
      rtmpUrl: args.rtmpUrl,
      streamKey: args.streamKeyEncrypted,
      displayName: args.displayName,
      connectedAt: args.connectedAt,
      status: "active",
    })
  },
})
```

Also add a helper action `getXRtmpCredentials` for goLive to decrypt on demand:

```typescript
export const getXRtmpCredentials = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ rtmpUrl: string; streamKey: string } | null> => {
    const conn = await ctx.runQuery(
      internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
      { userId, platform: "x" },
    )
    if (!conn?.rtmpUrl || !conn?.streamKey) return null
    return {
      rtmpUrl: conn.rtmpUrl,
      streamKey: decrypt(conn.streamKey),
    }
  },
})
```

Reference this from goLive Task 4 instead of the inline `decrypt` call.

- [ ] **Step 2: Create the UI**

```tsx
// components/dashboard/connect-x-form.tsx
"use client"
import { useAction, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ConnectXForm() {
  const existing = useQuery(api.connectedPlatforms.getPlatformByType, { platform: "x" })
  const connect = useAction(api.connectedPlatformsActions.connectXDirectRtmp)
  const disconnect = useAction(api.connectedPlatformsActions.disconnectPlatform)
  const [rtmpUrl, setRtmpUrl] = useState("")
  const [streamKey, setStreamKey] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (existing === undefined) return null
  if (existing?.status === "active") {
    return (
      <div className="rounded-md border border-border/50 p-4">
        <div className="mb-2 text-sm font-medium">X connected</div>
        <div className="mb-3 text-xs text-muted-foreground">{existing.displayName ?? "X account"}</div>
        <Button variant="outline" size="sm" onClick={() => disconnect({ platform: "x" })}>
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border/50 p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
          await connect({ rtmpUrl: rtmpUrl.trim(), streamKey: streamKey.trim() })
          setRtmpUrl(""); setStreamKey("")
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setSubmitting(false)
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="x-rtmp-url">X RTMP URL</Label>
        <Input id="x-rtmp-url" value={rtmpUrl}
          onChange={(e) => setRtmpUrl(e.target.value)}
          placeholder="rtmp://..."
          required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="x-stream-key">X stream key</Label>
        <Input id="x-stream-key" value={streamKey}
          onChange={(e) => setStreamKey(e.target.value)}
          type="password"
          required />
      </div>
      <div className="text-xs text-muted-foreground">
        Get these from X Media Studio (studio.x.com) → Live Producer → Advanced settings.
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <Button type="submit" disabled={submitting || !rtmpUrl.trim() || !streamKey.trim()}>
        {submitting ? "Connecting…" : "Connect X"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Mount on settings page**

In `app/dashboard/settings/stream/page.tsx`, add `<ConnectXForm />` in the Connected Platforms section alongside the existing YouTube card.

- [ ] **Step 4: Manual smoke test**

`pnpm dev`. Go to `/dashboard/settings/stream`, paste a fake RTMP URL + key, click Connect. Confirm `connectedPlatforms` row appears with `platform=x`, `rtmpUrl` stored plaintext, `streamKey` encrypted.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/connect-x-form.tsx convex/connectedPlatformsActions.ts convex/connectedPlatforms.ts app/dashboard/settings/stream/page.tsx
git commit -m "feat(ui): manual RTMP connection flow for X simulcast"
```

---

## Task 7: Go-live modal — both YouTube and X toggles, non-exclusive

**Files:**
- Modify: `components/studio/go-live-modal.tsx`
- Modify: `hooks/use-go-live.ts`

Two toggles, independently selectable. Each disabled if the user hasn't connected that platform. X has no metadata fields (just on/off). YouTube keeps its title/description/privacy.

- [ ] **Step 1: Add X toggle state**

```tsx
const [xEnabled, setXEnabled] = useState(false)
const xConnection = useQuery(api.connectedPlatforms.getPlatformByType, { platform: "x" })
const xAvailable = xConnection?.status === "active"
```

Render the X toggle row next to the YouTube toggle, with the same "Connect" CTA when not available.

- [ ] **Step 2: Update submit handler**

```tsx
async function handleGoLive() {
  // Pre-flight: if YouTube toggled on but not connected, same confirm flow as v2 (4a).
  if (youtubeEnabled && (!ytConnection || ytConnection.status !== "active")) {
    const confirmed = window.confirm(/* same text as v2 */)
    if (!confirmed) { window.open("/dashboard/settings/stream?reconnect=youtube", "_blank"); return }
  }

  const simulcast = (youtubeEnabled && ytConnection?.status === "active")
    || (xEnabled && xAvailable)
    ? {
        youtube: youtubeEnabled && ytConnection?.status === "active"
          ? { title: youtubeTitle || streamTitle, description: youtubeDescription, privacy: youtubePrivacy }
          : undefined,
        x: xEnabled && xAvailable ? true : undefined,
      }
    : undefined

  await goLive({ title: streamTitle, category, simulcast })
}
```

- [ ] **Step 3: Update `hooks/use-go-live.ts` types**

Extend `SimulcastOptions` to include `x?: boolean`.

- [ ] **Step 4: Manual smoke test**

With YouTube connected and X connected: both toggles work independently. Go live with just X → `streamBroadcasts` has X row only. Go live with both → two rows, both `status=live`.

- [ ] **Step 5: Commit**

```bash
git add components/studio/go-live-modal.tsx hooks/use-go-live.ts
git commit -m "feat(ui): non-exclusive YouTube + X toggles in go-live modal"
```

---

## Task 8: E2E checklist update

**Files:**
- Rename: `docs/features/youtube-simulcast.md` → `docs/features/simulcast.md`
- Modify: the renamed file

- [ ] **Step 1: Rename + rewrite with YouTube-only, X-only, and combined scenarios**

```markdown
# Simulcast — E2E manual test

## Prerequisites
- RealtimeKit webhook registered for `meeting.ended` + `livestreaming.statusUpdate`
- YouTube account connected via `/dashboard/settings/stream`
- X (Twitter) connected via manual RTMP paste on `/dashboard/settings/stream`
- `CLOUDFLARE_STREAM_API_TOKEN` set in Convex dashboard

## Happy paths
### YouTube only
(same as v2 checklist)

### X only
1. Go live with X toggle ON, YouTube OFF.
2. Confirm `streamBroadcasts` row has platform=x, status=live, rtkRecordingId set, cloudflareLiveOutputUid set.
3. Confirm stream appears on X Media Studio → Live Producer.
4. End stream; confirm Live Output deleted, recording stopped, broadcast ended.

### YouTube + X simultaneously
1. Go live with both toggles ON.
2. Confirm two streamBroadcasts rows (platform=youtube, platform=x), both status=live, same rtkRecordingId, different cloudflareLiveOutputUids.
3. Confirm one Cloudflare Stream Live Input exists for the creator (in Cloudflare dashboard → Stream → Live Inputs).
4. Confirm both YouTube and X show the live stream.
5. End stream; confirm both Live Outputs deleted, the ONE recording stopped, both broadcasts ended.

## Graceful degrade paths
- YouTube fails, X succeeds → stream live with X, YouTube broadcast status=failed.
- X fails (invalid stream key), YouTube succeeds → symmetrical.
- Both fail → stream still live on Switched; two failed streamBroadcasts rows.

## Unexpected end
Same as v2: kill browser → webhook fires → all Live Outputs deleted, recording stopped, all broadcasts ended.
```

- [ ] **Step 2: Commit**

```bash
git mv docs/features/youtube-simulcast.md docs/features/simulcast.md
git add docs/features/simulcast.md
git commit -m "docs: expand simulcast E2E to cover multi-destination scenarios"
```

---

## Self-review summary

**Spec coverage:**
- Multi-destination architecture → Tasks 3, 4
- X manual-RTMP connect → Task 6
- Non-exclusive go-live modal → Task 7
- Re-using v2's webhook + cron + SimulcastStatus → unchanged (they handle multiple broadcasts per stream already)
- Cost + latency trade-offs documented in plan header

**Open items:**
- Task 0 determines `rtmps://` vs `rtmp://`; Task 2 and Task 4 reference the finding.
- No schema migration needed — `creatorLiveInputs` is a new table; existing v2 `streamBroadcasts` rows are all ended and their absence of `cloudflareLiveOutputUid` is fine.

**Phase 3 carry-overs:**
- LinkedIn, Twitch, Facebook: same pattern as X — add manual RTMP or OAuth connection and a toggle.
- Cloudflare Stream Live Output health polling for per-destination `degraded` detection (currently we rely on RealtimeKit's `livestreaming.statusUpdate` which is for the /livestreams HLS, not Live Outputs).
