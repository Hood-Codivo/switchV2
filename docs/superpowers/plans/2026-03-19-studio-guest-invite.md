# Studio Guest Invite System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a creator generate a shareable invite link from the studio; guests join via `/studio/join/[token]`, wait for admission, then appear as live WebRTC sources in the creator's source tray.

**Architecture:** Invite tokens are random UUIDs stored in `studioSessions` with an expiry timestamp — no crypto signing needed, Convex is the authority. Guest state is tracked in a new `studioGuests` table; `useQuery` subscriptions give the creator real-time admit/reject prompts and the guest real-time status updates. RTK participant tokens for guests are created on-admit via a Convex `action()`.

**Tech Stack:** Convex (mutations/actions/queries), convex-test + vitest, Cloudflare RealtimeKit SDK (`@cloudflare/realtimekit`), `@cloudflare/realtimekit-react` (RealtimeKitProvider), `@cloudflare/realtimekit-react-ui` (RtkMicToggle, RtkCameraToggle), Next.js App Router, Tailwind CSS, lucide-react.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `convex/schema.ts` | Modify | Add `studioGuests` table; add `inviteToken`, `inviteTokenExpiresAt`, `streamId` to `studioSessions` |
| `convex/studio.ts` | Modify | Add all new queries/mutations/actions for guest invite flow |
| `convex/__tests__/studio.test.ts` | Modify | Tests for all new Convex functions |
| `app/studio/join/[token]/page.tsx` | Create | Public guest join route (no auth required) |
| `components/studio/guest-join-view.tsx` | Create | Full guest join UI: enter name → waiting → admitted (RTK) / rejected / removed |
| `components/studio/studio-connected.tsx` | Modify | Replace People panel stub with invite link + waiting/admitted guest list |
| `components/studio/studio-view.tsx` | Modify | Pass new guest props from `useStudio` to `StudioConnected` |
| `hooks/use-studio.ts` | Modify | Add `guests`, `generateInviteLink`, `admitGuest`, `rejectGuest`, `removeGuest` |

---

## Task 1: Schema — `studioGuests` table + `studioSessions` additions

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add `studioGuests` table and extend `studioSessions`**

```ts
// In studioSessions defineTable, add to the field list:
inviteToken: v.optional(v.string()),
inviteTokenExpiresAt: v.optional(v.number()),
streamId: v.optional(v.id("streams")),

// Add index after the existing indexes:
.index("by_invite_token", ["inviteToken"])

// New table:
studioGuests: defineTable({
  sessionId: v.id("studioSessions"),
  displayName: v.string(),
  rtkAuthToken: v.optional(v.string()),
  status: v.union(
    v.literal("waiting"),
    v.literal("admitted"),
    v.literal("rejected"),
    v.literal("removed"),
  ),
  createdAt: v.number(),
})
  .index("by_session", ["sessionId"])
  .index("by_session_and_status", ["sessionId", "status"]),
```

- [ ] **Step 2: Verify types generate cleanly**

```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add studioGuests table and invite token fields to studioSessions"
```

---

## Task 2: Convex backend — invite token + guest lifecycle

**Files:**
- Modify: `convex/studio.ts`
- Modify: `convex/__tests__/studio.test.ts`

### 2a. `generateInviteToken` mutation

Generates (or refreshes) a 24-hour invite token on the creator's active session.

- [ ] **Step 1: Write the failing test**

In `convex/__tests__/studio.test.ts`, add a new `describe` block:

```ts
describe("generateInviteToken", () => {
  it("stores an invite token on the active session and returns the token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    const token = await t.withIdentity({ subject: userId }).mutation(api.studio.generateInviteToken, {})

    expect(typeof token).toBe("string")
    expect(token.length).toBeGreaterThan(0)

    const session = await t.withIdentity({ subject: userId }).query(api.studio.getActiveSession, {})
    expect(session?.inviteToken).toBe(token)
    expect(session?.inviteTokenExpiresAt).toBeGreaterThan(Date.now())
  })

  it("throws if there is no active session", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    await expect(
      t.withIdentity({ subject: userId }).mutation(api.studio.generateInviteToken, {}),
    ).rejects.toThrow("No active studio session")
  })

  it("throws if unauthenticated", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.studio.generateInviteToken, {}),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```
Expected: FAIL — `generateInviteToken` not defined.

- [ ] **Step 3: Implement `generateInviteToken` in `convex/studio.ts`**

```ts
export const generateInviteToken = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", userId).eq("status", "active"),
      )
      .first()
    if (!session) throw new Error("No active studio session")

    const token = crypto.randomUUID()
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    await ctx.db.patch(session._id, { inviteToken: token, inviteTokenExpiresAt: expiresAt })
    return token
  },
})
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add convex/studio.ts convex/__tests__/studio.test.ts
git commit -m "feat: generateInviteToken mutation with 24h expiry"
```

---

### 2b. `getSessionByInviteToken` query + `requestGuestJoin` mutation

Public (no auth) — used by the guest join page.

- [ ] **Step 1: Write failing tests**

```ts
describe("getSessionByInviteToken", () => {
  it("returns session info for a valid, unexpired token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })

    const result = await t.query(api.studio.getSessionByInviteToken, { token: "valid-token" })
    expect(result?.sessionId).toBe(sessionId)
    expect(result?.expired).toBe(false)
  })

  it("returns expired:true for an expired token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "expired-token",
        inviteTokenExpiresAt: Date.now() - 1,
      })
    })

    const result = await t.query(api.studio.getSessionByInviteToken, { token: "expired-token" })
    expect(result?.expired).toBe(true)
  })

  it("returns null for an unknown token", async () => {
    const t = convexTest(schema, modules)
    const result = await t.query(api.studio.getSessionByInviteToken, { token: "unknown" })
    expect(result).toBeNull()
  })
})

describe("requestGuestJoin", () => {
  it("creates a waiting guest record and returns its id", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "valid-token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })

    const guestId = await t.mutation(api.studio.requestGuestJoin, {
      token: "valid-token",
      displayName: "Bob",
    })

    expect(guestId).toBeDefined()

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("waiting")
    expect(guest?.displayName).toBe("Bob")
  })

  it("throws for an expired token", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "expired-token",
        inviteTokenExpiresAt: Date.now() - 1,
      })
    })

    await expect(
      t.mutation(api.studio.requestGuestJoin, { token: "expired-token", displayName: "Bob" }),
    ).rejects.toThrow("expired")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Implement in `convex/studio.ts`**

```ts
export const getSessionByInviteToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ sessionId: Id<"studioSessions">; expired: boolean } | null> => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first()
    if (!session) return null
    const expired = (session.inviteTokenExpiresAt ?? 0) < Date.now()
    return { sessionId: session._id, expired }
  },
})

export const requestGuestJoin = mutation({
  args: { token: v.string(), displayName: v.string() },
  handler: async (ctx, { token, displayName }): Promise<Id<"studioGuests">> => {
    const session = await ctx.db
      .query("studioSessions")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first()
    if (!session) throw new Error("Invalid invite token")
    if ((session.inviteTokenExpiresAt ?? 0) < Date.now()) throw new Error("Invite token has expired")

    return ctx.db.insert("studioGuests", {
      sessionId: session._id,
      displayName: displayName.trim().slice(0, 40),
      status: "waiting",
      createdAt: Date.now(),
    })
  },
})
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add convex/studio.ts convex/__tests__/studio.test.ts
git commit -m "feat: getSessionByInviteToken query and requestGuestJoin mutation"
```

---

### 2c. `listSessionGuests` query + `getGuestStatus` query

- [ ] **Step 1: Write failing tests**

```ts
describe("listSessionGuests", () => {
  it("returns all guests for a session ordered by createdAt", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    await t.mutation(api.studio.requestGuestJoin, { token: "token", displayName: "Bob" })
    await t.mutation(api.studio.requestGuestJoin, { token: "token", displayName: "Carol" })

    const guests = await t.withIdentity({ subject: userId }).query(api.studio.listSessionGuests, { sessionId })
    expect(guests).toHaveLength(2)
    expect(guests.map((g) => g.displayName)).toContain("Bob")
    expect(guests.map((g) => g.displayName)).toContain("Carol")
  })

  it("throws if the caller is not the creator of the session", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: alice as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })

    await expect(
      t.withIdentity({ subject: bob }).query(api.studio.listSessionGuests, { sessionId }),
    ).rejects.toThrow("Unauthorized")
  })
})

describe("getGuestStatus", () => {
  it("returns the guest record for a given guestId", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "token", displayName: "Bob" })

    const guest = await t.query(api.studio.getGuestStatus, { guestId })
    expect(guest?.status).toBe("waiting")
    expect(guest?.displayName).toBe("Bob")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Implement in `convex/studio.ts`**

```ts
export const listSessionGuests = query({
  args: { sessionId: v.id("studioSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const session = await ctx.db.get(sessionId)
    if (!session || session.creatorId !== userId) throw new Error("Unauthorized")

    return ctx.db
      .query("studioGuests")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect()
  },
})

export const getGuestStatus = query({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => {
    return ctx.db.get(guestId)
  },
})
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add convex/studio.ts convex/__tests__/studio.test.ts
git commit -m "feat: listSessionGuests and getGuestStatus queries"
```

---

### 2d. `admitGuest` action + `rejectGuest` / `removeGuest` mutations

- [ ] **Step 1: Write failing tests for `rejectGuest` and `removeGuest`** (mutations only — `admitGuest` is an action that calls Cloudflare API, tested manually)

```ts
describe("rejectGuest", () => {
  it("sets guest status to rejected", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "token", displayName: "Bob" })

    await t.withIdentity({ subject: userId }).mutation(api.studio.rejectGuest, { guestId })

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("rejected")
  })

  it("throws if caller is not the session creator", async () => {
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const bob = await t.run(async (ctx) => seedUser(ctx, "bob"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: alice as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "token", displayName: "Bob" })

    await expect(
      t.withIdentity({ subject: bob }).mutation(api.studio.rejectGuest, { guestId }),
    ).rejects.toThrow("Unauthorized")
  })
})

describe("removeGuest", () => {
  it("sets guest status to removed", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))
    const sessionId = await t.mutation(internal.studio.storeStudioSession, {
      creatorId: userId as DataModel["studioSessions"]["document"]["creatorId"],
      cloudflareRoomId: "cf-room-1",
      creatorAuthToken: "token-1",
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        inviteToken: "token",
        inviteTokenExpiresAt: Date.now() + 60_000,
      })
    })
    const guestId = await t.mutation(api.studio.requestGuestJoin, { token: "token", displayName: "Bob" })

    await t.withIdentity({ subject: userId }).mutation(api.studio.removeGuest, { guestId })

    const guest = await t.run(async (ctx) => ctx.db.get(guestId))
    expect(guest?.status).toBe("removed")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Implement mutations + `admitGuestRecord` internalMutation + `admitGuest` action in `convex/studio.ts`**

```ts
// ── Internal mutation called by admitGuest action ──────────────────────────

export const admitGuestRecord = internalMutation({
  args: { guestId: v.id("studioGuests"), rtkAuthToken: v.string() },
  handler: async (ctx, { guestId, rtkAuthToken }) => {
    await ctx.db.patch(guestId, { status: "admitted", rtkAuthToken })
  },
})

// ── Public mutations ────────────────────────────────────────────────────────

export const rejectGuest = mutation({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const guest = await ctx.db.get(guestId)
    if (!guest) throw new Error("Guest not found")

    const session = await ctx.db.get(guest.sessionId)
    if (!session || session.creatorId !== userId) throw new Error("Unauthorized")

    await ctx.db.patch(guestId, { status: "rejected" })
  },
})

export const removeGuest = mutation({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const guest = await ctx.db.get(guestId)
    if (!guest) throw new Error("Guest not found")

    const session = await ctx.db.get(guest.sessionId)
    if (!session || session.creatorId !== userId) throw new Error("Unauthorized")

    await ctx.db.patch(guestId, { status: "removed" })
  },
})

// ── admitGuest action (calls Cloudflare RTK API) ───────────────────────────

export const admitGuest = action({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }): Promise<void> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not authenticated")

    const guest = await ctx.runQuery(internal.studio.getGuestById, { guestId })
    if (!guest) throw new Error("Guest not found")

    const session = await ctx.runQuery(internal.studio.getSessionById, { sessionId: guest.sessionId })
    if (!session || session.creatorId !== (userId as Id<"users">)) throw new Error("Unauthorized")

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    const appId = process.env.CLOUDFLARE_REALTIMEKIT_APP_ID
    if (!accountId || !apiToken || !appId) throw new Error("Cloudflare Realtime not configured")

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    }

    const participantRes = await fetch(
      `${baseUrl}/meetings/${session.cloudflareRoomId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: guest.displayName,
          preset_name: "livestream_cohost",
          custom_participant_id: guestId,
        }),
      },
    )
    if (!participantRes.ok) {
      const body = await participantRes.text()
      throw new Error(`Failed to create guest participant: ${participantRes.status} — ${body}`)
    }
    const { data } = (await participantRes.json()) as { data: { token: string } }

    await ctx.runMutation(internal.studio.admitGuestRecord, {
      guestId,
      rtkAuthToken: data.token,
    })
  },
})
```

Add two new `internalQuery` helpers (needed by `admitGuest` action to read data):

```ts
export const getGuestById = internalQuery({
  args: { guestId: v.id("studioGuests") },
  handler: async (ctx, { guestId }) => ctx.db.get(guestId),
})

export const getSessionById = internalQuery({
  args: { sessionId: v.id("studioSessions") },
  handler: async (ctx, { sessionId }) => ctx.db.get(sessionId),
})
```

Also add `internalQuery` to the imports at the top of `convex/studio.ts`.

- [ ] **Step 4: Run all studio tests**

```bash
cd convex && npx vitest run __tests__/studio.test.ts 2>&1 | tail -30
```
Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add convex/studio.ts convex/__tests__/studio.test.ts
git commit -m "feat: admitGuest action, rejectGuest/removeGuest mutations, internal helpers"
```

---

## Task 3: Guest join page — `/studio/join/[token]`

**Files:**
- Create: `app/studio/join/[token]/page.tsx`
- Create: `components/studio/guest-join-view.tsx`

### 3a. Page route

- [ ] **Step 1: Create `app/studio/join/[token]/page.tsx`**

Next.js 15+ requires dynamic `params` to be awaited (they are a Promise).

```tsx
import { GuestJoinView } from "@/components/studio/guest-join-view"

export default async function GuestJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <GuestJoinView token={token} />
}
```

### 3b. `GuestJoinView` component

This is a pure client component. It manages the full guest lifecycle:

States: `"validating"` → `"enter-name"` → `"waiting"` → `"admitted"` | `"rejected"` | `"removed"` | `"error"`

- [ ] **Step 2: Create `components/studio/guest-join-view.tsx`**

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { RealtimeKitProvider } from "@cloudflare/realtimekit-react"
import { RtkMicToggle, RtkCameraToggle } from "@cloudflare/realtimekit-react-ui"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import RTKClient from "@cloudflare/realtimekit"

// ── Types ────────────────────────────────────────────────────────────────────

type JoinPhase =
  | { step: "enter-name" }
  | { step: "waiting"; guestId: Id<"studioGuests"> }
  | { step: "admitted"; rtkClient: RTKClient; guestId: Id<"studioGuests"> }
  | { step: "rejected" }
  | { step: "removed" }
  | { step: "error"; message: string }

// ── Waiting room: subscribes to guest status via Convex ───────────────────────
// useEffect is required here: Convex subscription change → side effect (RTK init).
// Calling setPhase directly in render would be setState-during-render.

function WaitingRoom({
  guestId,
  onAdmitted,
  onRejected,
}: {
  guestId: Id<"studioGuests">
  onAdmitted: (rtkAuthToken: string) => void
  onRejected: () => void
}) {
  const guest = useQuery(api.studio.getGuestStatus, { guestId })

  useEffect(() => {
    if (guest?.status === "admitted" && guest.rtkAuthToken) {
      onAdmitted(guest.rtkAuthToken)
    } else if (guest?.status === "rejected") {
      onRejected()
    }
  }, [guest?.status, guest?.rtkAuthToken, onAdmitted, onRejected])

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      <div>
        <p className="font-medium">Waiting to be admitted</p>
        <p className="mt-1 text-sm text-zinc-400">The host will let you in shortly.</p>
      </div>
    </div>
  )
}

// ── Admitted: RTK client active, guest controls ───────────────────────────────
// Wraps content in RealtimeKitProvider so RtkMicToggle and RtkCameraToggle
// can subscribe to RTK state internally — no manual audioEnabled tracking needed.
// Removal detection still uses Convex subscription + useEffect (legitimate side effect).

function AdmittedView({
  client,
  guestId,
  onRemoved,
}: {
  client: RTKClient
  guestId: Id<"studioGuests">
  onRemoved: () => void
}) {
  const guest = useQuery(api.studio.getGuestStatus, { guestId })

  // Detect removal via Convex subscription — leaveRoom is a side effect
  useEffect(() => {
    if (guest?.status === "removed") {
      void client.leaveRoom().then(onRemoved)
    }
  }, [guest?.status, client, onRemoved])

  if (guest?.status === "removed") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="font-medium">You have been removed from the studio.</p>
      </div>
    )
  }

  return (
    <RealtimeKitProvider value={client}>
      <div className="flex flex-col items-center gap-6">
        <div>
          <p className="text-lg font-semibold">You&apos;re live in the studio</p>
          <p className="mt-1 text-sm text-zinc-400">The host can see and hear you.</p>
        </div>
        <div className="flex gap-3">
          <RtkMicToggle />
          <RtkCameraToggle />
        </div>
      </div>
    </RealtimeKitProvider>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function GuestJoinView({ token }: { token: string }) {
  const [phase, setPhase] = useState<JoinPhase>({ step: "enter-name" })
  const [displayName, setDisplayName] = useState("")

  const tokenInfo = useQuery(api.studio.getSessionByInviteToken, { token })
  const requestJoin = useMutation(api.studio.requestGuestJoin)

  const handleAdmitted = useCallback(
    async (rtkAuthToken: string, guestId: Id<"studioGuests">) => {
      try {
        const client = await RTKClient.init({ authToken: rtkAuthToken })
        await client.join()
        setPhase({ step: "admitted", rtkClient: client, guestId })
      } catch (err) {
        setPhase({
          step: "error",
          message: err instanceof Error ? err.message : "Failed to connect",
        })
      }
    },
    [],
  )

  // Token is still loading
  if (tokenInfo === undefined) {
    return (
      <Shell>
        <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </Shell>
    )
  }

  // Invalid or expired token
  if (tokenInfo === null || tokenInfo.expired) {
    return (
      <Shell>
        <p className="text-sm text-red-400">
          {tokenInfo === null ? "This invite link is not valid." : "This invite link has expired."}
        </p>
      </Shell>
    )
  }

  if (phase.step === "error") {
    return (
      <Shell>
        <p className="text-sm text-red-400">{phase.message}</p>
        <button
          onClick={() => setPhase({ step: "enter-name" })}
          className="mt-2 text-sm text-zinc-400 underline"
        >
          Try again
        </button>
      </Shell>
    )
  }

  if (phase.step === "rejected") {
    return (
      <Shell>
        <p className="font-medium">You were not admitted to the studio.</p>
      </Shell>
    )
  }

  if (phase.step === "removed") {
    return (
      <Shell>
        <p className="font-medium">You have been removed from the studio.</p>
      </Shell>
    )
  }

  if (phase.step === "enter-name") {
    return (
      <Shell>
        <div className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Join the studio</h1>
            <p className="mt-1 text-sm text-zinc-400">Enter a display name to request entry.</p>
          </div>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <button
            disabled={!displayName.trim()}
            onClick={async () => {
              try {
                const guestId = await requestJoin({ token, displayName: displayName.trim() })
                setPhase({ step: "waiting", guestId })
              } catch (err) {
                setPhase({
                  step: "error",
                  message: err instanceof Error ? err.message : "Failed to request entry",
                })
              }
            }}
            className="w-full rounded-full bg-white py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request to join
          </button>
        </div>
      </Shell>
    )
  }

  if (phase.step === "waiting") {
    const { guestId } = phase
    return (
      <Shell>
        <WaitingRoom
          guestId={guestId}
          onAdmitted={(rtkAuthToken) => void handleAdmitted(rtkAuthToken, guestId)}
          onRejected={() => setPhase({ step: "rejected" })}
        />
      </Shell>
    )
  }

  if (phase.step === "admitted") {
    return (
      <Shell>
        <AdmittedView
          client={phase.rtkClient}
          guestId={phase.guestId}
          onRemoved={() => setPhase({ step: "removed" })}
        />
      </Shell>
    )
  }

  return null
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/studio/join components/studio/guest-join-view.tsx
git commit -m "feat: guest join page /studio/join/[token] with waiting room and RTK admit"
```

---

## Task 4: Creator People panel — invite link + guest management

**Files:**
- Modify: `hooks/use-studio.ts`
- Modify: `components/studio/studio-connected.tsx`

### 4a. Hook additions

- [ ] **Step 1: Add to `hooks/use-studio.ts`**

Add new imports and types at the top:
```ts
// Extend the existing convex/react import line to include useMutation:
// Before: import { useAction, useQuery } from "convex/react"
// After:  import { useAction, useMutation, useQuery } from "convex/react"
import type { Id } from "@/convex/_generated/dataModel"

export type StudioGuest = {
  _id: Id<"studioGuests">
  displayName: string
  status: "waiting" | "admitted" | "rejected" | "removed"
  rtkAuthToken?: string
}
```

Add to `UseStudioReturn`:
```ts
guests: StudioGuest[]
sessionId: Id<"studioSessions"> | null
generateInviteLink: () => Promise<string>
admitGuest: (guestId: Id<"studioGuests">) => Promise<void>
rejectGuest: (guestId: Id<"studioGuests">) => void
removeGuest: (guestId: Id<"studioGuests">) => void
```

Inside `useStudio()`:

```ts
// Existing activeSession subscription (line 130) — extend to capture sessionId:
const activeSession = useQuery(api.studio.getActiveSession)

// Subscribe to guests for the active session
const rawGuests = useQuery(
  api.studio.listSessionGuests,
  activeSession?._id ? { sessionId: activeSession._id } : "skip",
)
const guests: StudioGuest[] = (rawGuests ?? []).filter(
  (g) => g.status === "waiting" || g.status === "admitted",
)

const generateInviteTokenAction = useMutation(api.studio.generateInviteToken)
const admitGuestAction = useAction(api.studio.admitGuest)
const rejectGuestMutation = useMutation(api.studio.rejectGuest)
const removeGuestMutation = useMutation(api.studio.removeGuest)

const generateInviteLink = useCallback(async (): Promise<string> => {
  const token = await generateInviteTokenAction({})
  return `${window.location.origin}/studio/join/${token}`
}, [generateInviteTokenAction])

const admitGuest = useCallback(
  async (guestId: Id<"studioGuests">) => {
    await admitGuestAction({ guestId })
  },
  [admitGuestAction],
)

const rejectGuest = useCallback(
  (guestId: Id<"studioGuests">) => {
    void rejectGuestMutation({ guestId })
  },
  [rejectGuestMutation],
)

const removeGuest = useCallback(
  (guestId: Id<"studioGuests">) => {
    void removeGuestMutation({ guestId })
  },
  [removeGuestMutation],
)
```

Return these from `useStudio`:
```ts
guests,
sessionId: activeSession?._id ?? null,
generateInviteLink,
admitGuest,
rejectGuest,
removeGuest,
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add hooks/use-studio.ts
git commit -m "feat: add guest management to useStudio hook"
```

---

### 4b. People panel in `studio-connected.tsx`

Replace the `SidebarEmpty` stub for the "people" tab with real content.

- [ ] **Step 1: Add `PeoplePanel` to `studio-connected.tsx`**

Add to `StudioConnectedProps`:
```ts
guests: StudioGuest[]
generateInviteLink: () => Promise<string>
admitGuest: (guestId: Id<"studioGuests">) => Promise<void>
rejectGuest: (guestId: Id<"studioGuests">) => void
removeGuest: (guestId: Id<"studioGuests">) => void
```

Add the `PeoplePanel` component inside the file (single use, stays co-located):

```tsx
import type { StudioGuest } from "@/hooks/use-studio"
import type { Id } from "@/convex/_generated/dataModel"
import { Copy, Check, UserMinus, Users } from "lucide-react"

function PeoplePanel({
  guests,
  generateInviteLink,
  admitGuest,
  rejectGuest,
  removeGuest,
}: {
  guests: StudioGuest[]
  generateInviteLink: () => Promise<string>
  admitGuest: (guestId: Id<"studioGuests">) => Promise<void>
  rejectGuest: (guestId: Id<"studioGuests">) => void
  removeGuest: (guestId: Id<"studioGuests">) => void
}) {
  const [copied, setCopied] = useState(false)

  const waitingGuests = guests.filter((g) => g.status === "waiting")
  const admittedGuests = guests.filter((g) => g.status === "admitted")

  async function handleCopyLink() {
    const link = await generateInviteLink()
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Invite button */}
      <button
        onClick={() => void handleCopyLink()}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-600 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
      >
        {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
        {copied ? "Link copied!" : "Copy invite link"}
      </button>

      {/* Waiting guests */}
      {waitingGuests.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            Waiting
          </p>
          <div className="space-y-2">
            {waitingGuests.map((g) => (
              <div
                key={g._id}
                className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2"
              >
                <span className="text-sm text-zinc-300">{g.displayName}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void admitGuest(g._id)}
                    className="rounded bg-green-600/20 px-2 py-1 text-[10px] font-semibold text-green-400 hover:bg-green-600/30"
                  >
                    Admit
                  </button>
                  <button
                    onClick={() => rejectGuest(g._id)}
                    className="rounded bg-red-600/20 px-2 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-600/30"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admitted guests */}
      {admittedGuests.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            In studio
          </p>
          <div className="space-y-2">
            {admittedGuests.map((g) => (
              <div
                key={g._id}
                className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-green-500" />
                  <span className="text-sm text-zinc-300">{g.displayName}</span>
                </div>
                <button
                  onClick={() => removeGuest(g._id)}
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                  title="Remove from studio"
                >
                  <UserMinus className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {guests.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Users className="size-8 text-zinc-700" />
          <div>
            <p className="text-sm font-medium text-zinc-500">People</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-700">
              Share the invite link to bring guests into your studio.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
```

In the sidebar render, replace the "people" case in `SidebarEmpty` with:

```tsx
{activeTab === "people" ? (
  <PeoplePanel
    guests={guests}
    generateInviteLink={generateInviteLink}
    admitGuest={admitGuest}
    rejectGuest={rejectGuest}
    removeGuest={removeGuest}
  />
) : (
  <SidebarEmpty tab={activeTab} />
)}
```

- [ ] **Step 2: Update `studio-view.tsx` to pass the new props through**

```tsx
<StudioConnected
  {/* ...existing props... */}
  guests={studio.guests}
  generateInviteLink={studio.generateInviteLink}
  admitGuest={studio.admitGuest}
  rejectGuest={studio.rejectGuest}
  removeGuest={studio.removeGuest}
/>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Run all Convex tests one final time**

```bash
cd convex && npx vitest run 2>&1 | tail -30
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add components/studio/studio-connected.tsx components/studio/studio-view.tsx
git commit -m "feat: People panel with invite link, waiting room admit/reject, and guest removal"
```

---

## Final verification

- [ ] `pnpm typecheck` — clean
- [ ] `cd convex && npx vitest run` — all tests pass
- [ ] Manual smoke test:
  1. Open studio as creator → People tab → "Copy invite link" generates a `/studio/join/[token]` URL
  2. Open link in a second browser tab (incognito) → enter name → "Request to join"
  3. Creator sees waiting prompt → click "Admit" → guest connects to RTK
  4. Guest tile appears in creator's source tray — **this is automatic**: when the guest calls `client.join()`, RTK fires `participantJoined` on the creator's client, which triggers `refreshSources()` in `use-studio.ts`. No additional implementation needed.
  5. Guest can mute/unmute from their page
  6. Creator clicks Remove → guest sees "removed" message and is disconnected
  7. Creator clicks Reject on a waiting guest → guest sees "not admitted"
  8. Open an expired/invalid link → error message shown
