# Unified Studio Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `/studio/guest/[guestId]` into `/studio/[sessionId]` so host and guest share one URL and one UI.

**Architecture:** The host creates a session at `/studio` then is redirected to `/studio/[sessionId]`. Guests admitted via invite land at `/studio/[sessionId]?guestId=XXX`. The page renders `HostSessionView` or `GuestSessionView` based on the `guestId` param — both render the same `StudioConnected` component. `useStudio` gains an auto-reconnect path so the host's RTK connection is re-established after the navigation.

**Key tradeoff — double-connect on every host session start:** When the host navigates from `/studio` → `/studio/[sessionId]`, React unmounts `StudioView` (tearing down the RTK connection) and mounts `HostSessionView` (which auto-reconnects). This means every host session goes through a brief disconnect/reconnect cycle and shows a spinner for ~1 second. This is an intentional tradeoff of the redirect-based approach. A future improvement could lift RTK state into a shared layout context to survive navigation without teardown.

**Tech Stack:** Next.js 16 App Router, Convex, Cloudflare RealtimeKit (`@cloudflare/realtimekit-react`), TypeScript strict, Tailwind CSS v4.

---

## File Map

| Action | File |
|---|---|
| Modify | `convex/studio.ts` — `createStudioSession` returns `sessionId` |
| Modify | `hooks/use-studio.ts` — extract `connectWithToken`, add auto-reconnect effect, add `sessionLoaded`, add unmount `leaveRoom` |
| Modify | `components/studio/studio-view.tsx` — redirect to `/studio/[sessionId]` when connected |
| **Create** | `app/studio/[sessionId]/page.tsx` — server shell + `HostSessionView` + `GuestSessionView` |
| Modify | `components/studio/guest-join-view.tsx` — thread `sessionId` through `WaitingRoom`, update redirect |
| **Delete** | `app/studio/guest/[guestId]/page.tsx` |
| **Delete** | `components/studio/guest-studio-page.tsx` |

---

### Task 1: Return `sessionId` from `createStudioSession`

**Files:**
- Modify: `convex/studio.ts:206,255-261`

- [ ] **Step 1: Update the return type and capture the session ID**

In `convex/studio.ts`, find `createStudioSession`. It currently calls `ctx.runMutation(internal.studio.storeStudioSession, ...)` but discards the return value. Change it:

```typescript
// Line ~206 — update return type annotation
handler: async (ctx): Promise<{ authToken: string; roomId: string; sessionId: Id<"studioSessions"> }> => {

// Line ~255 — capture the returned ID
const sessionId = await ctx.runMutation(internal.studio.storeStudioSession, {
  creatorId: userId as Id<"users">,
  cloudflareRoomId: meetingId,
  creatorAuthToken: participant.token,
})

// Line ~261 — include it in the return
return { authToken: participant.token, roomId: meetingId, sessionId }
```

- [ ] **Step 2: Verify types**

```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/studio.ts
git commit -m "feat: createStudioSession returns sessionId"
```

---

### Task 2: Refactor `useStudio` — extract `connectWithToken`, auto-reconnect, cleanup

**Files:**
- Modify: `hooks/use-studio.ts`

This task makes three related changes to `useStudio`:
1. Extracts the RTK init sequence into `connectWithToken` (shared by `startSession` and auto-reconnect)
2. Adds an auto-reconnect effect for when the host navigates directly to `/studio/[sessionId]`
3. Adds `leaveRoom` on unmount so RTK is cleanly released when navigating away from `/studio`
4. Adds `sessionLoaded: boolean` to the return so `HostSessionView` can distinguish "Convex is loading" from "no session exists"

- [ ] **Step 1: Add `sessionLoaded` to `UseStudioReturn`**

In the `UseStudioReturn` type (around line 44), add:
```typescript
sessionLoaded: boolean   // true once getActiveSession has resolved (even if null)
```

- [ ] **Step 2: Extract `connectWithToken` from `startSession`**

Replace the current `startSession` implementation with two functions. Insert this block where `startSession` currently starts (around line 328):

```typescript
// ─── RTK connection ───────────────────────────────────────────────────────
// Shared by startSession (new session) and auto-reconnect (existing session).

const connectWithToken = useCallback(async (authToken: string) => {
  setStatus("connecting")
  const client = await initMeeting({ authToken })
  if (!client) throw new Error("Failed to initialize RTK client")
  await client.join()

  rtkClientRef.current = client
  isActiveRef.current = true

  /* eslint-disable @typescript-eslint/no-explicit-any */
  ;(client.self as any).on("videoUpdate", refreshSources)
  ;(client.self as any).on("audioUpdate", refreshSources)
  ;(client.self as any).on("screenShareUpdate", refreshSources)
  ;(client.participants.joined as any).on("participantJoined", refreshSources)
  ;(client.participants.joined as any).on("participantLeft", refreshSources)
  ;(client.participants.joined as any).on("videoUpdate", refreshSources)
  ;(client.participants.joined as any).on("audioUpdate", refreshSources)
  /* eslint-enable @typescript-eslint/no-explicit-any */

  refreshSources()
  const selfCamera = sourcesRef.current.find((s) => s.id === `${client.self.id}:camera`) ?? null
  const layout = STUDIO_LAYOUT_MAP[DEFAULT_LAYOUT_ID]
  const initialSlots: (StudioSource | null)[] = layout.slots.map((_, i) => (i === 0 ? selfCamera : null))
  setOnCanvasSlots(initialSlots)

  startCompositorLoop()
  await refreshDevices()
  setStatus("connected")
}, [initMeeting, refreshSources, setOnCanvasSlots, startCompositorLoop, refreshDevices])

const startSession = useCallback(async () => {
  try {
    setStatus("requesting-session")
    setError(null)
    const { authToken } = await createSession({})
    await connectWithToken(authToken)
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to start studio session")
    setStatus("error")
  }
}, [createSession, connectWithToken])
```

Delete the old `startSession` implementation that was there before.

- [ ] **Step 3: Add auto-reconnect effect and a ref guard**

Add a `hasAutoConnectedRef` near the other refs (around line 138):
```typescript
const hasAutoConnectedRef = useRef(false)
```

Add this effect after the existing session lifecycle effects (after the `startSession`/`endSession` block, before track controls):

```typescript
// Auto-reconnect when navigating to /studio/[sessionId] after a redirect from /studio.
// The redirect unmounts StudioView (leaveRoom fires), then HostSessionView mounts fresh.
// This effect re-joins using the session's stored creatorAuthToken from Convex.
// Also handles direct navigation (bookmark/reload) to /studio/[sessionId].
useEffect(() => {
  if (status !== "idle") return
  if (!activeSession?.creatorAuthToken) return
  if (hasAutoConnectedRef.current) return
  hasAutoConnectedRef.current = true
  void connectWithToken(activeSession.creatorAuthToken).catch((err) => {
    setError(err instanceof Error ? err.message : "Failed to reconnect to studio")
    setStatus("error")
  })
}, [status, activeSession, connectWithToken])
```

Also reset `hasAutoConnectedRef` inside `endSession` so a host who ends a session and starts a new one in the same browser tab can auto-reconnect again. Find the `endSession` callback and add the reset at the end of its `finally` block:

```typescript
// Inside endSession, after setStatus("idle"):
hasAutoConnectedRef.current = false
```

- [ ] **Step 4: Update the unmount cleanup to call `leaveRoom`**

Find the existing cleanup `useEffect` (around line 524):
```typescript
// Before:
useEffect(() => {
  return () => {
    stopCompositorLoop()
  }
}, [stopCompositorLoop])
```

Replace with:
```typescript
useEffect(() => {
  return () => {
    if (isActiveRef.current && rtkClientRef.current) {
      void rtkClientRef.current.leaveRoom().catch(() => {})
      isActiveRef.current = false
      rtkClientRef.current = null
    }
    stopCompositorLoop()
  }
}, [stopCompositorLoop])
```

- [ ] **Step 5: Add `sessionLoaded` to the return object**

At the bottom of `useStudio`, find the return statement. Add `sessionLoaded`:
```typescript
return {
  // ... existing fields ...
  sessionId: activeSession?._id ?? null,
  sessionLoaded: activeSession !== undefined,  // add this line
  // ... rest of fields ...
}
```

- [ ] **Step 6: Verify types**

```bash
pnpm typecheck
```
Expected: no errors. If `connectWithToken` deps warn, ensure all referenced values are in the dep array.

- [ ] **Step 7: Commit**

```bash
git add hooks/use-studio.ts
git commit -m "feat: useStudio — extract connectWithToken, auto-reconnect, sessionLoaded"
```

---

### Task 3: Redirect host to `/studio/[sessionId]` after connecting

**Files:**
- Modify: `components/studio/studio-view.tsx`

- [ ] **Step 1: Add router import**

At the top of `studio-view.tsx`, add `useRouter` to the existing next/navigation import (or add the import if absent):
```typescript
import { useRouter } from "next/navigation"
```

- [ ] **Step 2: Add redirect effect and replace connected branch**

In `StudioView`, after `const studio = useStudio()`, add:

```typescript
const router = useRouter()

// Once connected, hand off to /studio/[sessionId].
// StudioConnected is now rendered there, not here.
useEffect(() => {
  if (studio.status === "connected" && studio.sessionId) {
    router.push(`/studio/${studio.sessionId}`)
  }
}, [studio.status, studio.sessionId, router])
```

Then replace the connected return branch (currently `return <RealtimeKitProvider...><StudioConnected.../></RealtimeKitProvider>`) with a spinner that shows while the redirect fires:

```typescript
// Replace the existing connected return with:
if (status === "connected") {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
    </div>
  )
}
```

Remove the `RealtimeKitProvider`, `RtkParticipantsAudio`, and `StudioConnected` imports from this file if they become unused after this change.

- [ ] **Step 3: Verify types and lint**

```bash
pnpm typecheck && pnpm lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/studio/studio-view.tsx
git commit -m "feat: studio-view redirects to /studio/[sessionId] when connected"
```

---

### Task 4: Create `/studio/[sessionId]/page.tsx`

**Files:**
- Create: `app/studio/[sessionId]/page.tsx`

This is the unified in-session page. It contains three things: a server component shell, `HostSessionView` (client), and `GuestSessionView` (client). They live in the same file per CLAUDE.md convention (co-locate until reused elsewhere).

- [ ] **Step 1: Create the file**

Create `app/studio/[sessionId]/page.tsx` with this content:

```typescript
import { RealtimeKitProvider } from "@cloudflare/realtimekit-react"
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui"
import { useQuery } from "convex/react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { useStudio } from "@/hooks/use-studio"
import { useGuestStudio } from "@/hooks/use-guest-studio"
import { StudioConnected } from "@/components/studio/studio-connected"
import type { Id } from "@/convex/_generated/dataModel"

// ── Server shell ──────────────────────────────────────────────────────────────

export default async function StudioSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ guestId?: string }>
}) {
  const { sessionId } = await params
  const { guestId } = await searchParams

  if (guestId) {
    return <GuestSessionView sessionId={sessionId} guestId={guestId} />
  }
  return <HostSessionView sessionId={sessionId} />
}

// ── Shared shell ──────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      {children}
    </div>
  )
}

// ── Host view ─────────────────────────────────────────────────────────────────
// useStudio auto-connects when it sees an active session. This component just
// waits for "connected" and then renders StudioConnected. On idle + no session
// (bookmark/reload after session ended) it redirects back to /studio.

"use client"

function HostSessionView({ sessionId: _sessionId }: { sessionId: string }) {
  const router = useRouter()
  const studio = useStudio()
  const { status, error, client, sessionLoaded } = studio

  useEffect(() => {
    if (status === "idle" && sessionLoaded && studio.sessionId === null) {
      router.replace("/studio")
    }
  }, [status, sessionLoaded, studio.sessionId, router])

  if (status === "error") {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error ?? "Failed to connect to studio"}</p>
        <a href="/studio" className="mt-2 text-sm text-zinc-400 underline">
          Back to Studio
        </a>
      </Shell>
    )
  }

  if (status !== "connected" || !client) {
    return (
      <Shell>
        <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </Shell>
    )
  }

  return (
    <RealtimeKitProvider value={client}>
      <RtkParticipantsAudio />
      <StudioConnected
        compositorStream={studio.compositorStream}
        sources={studio.sources}
        onCanvasSlots={studio.onCanvasSlots}
        activeLayoutId={studio.activeLayoutId}
        cameras={studio.cameras}
        microphones={studio.microphones}
        toggleVideo={studio.toggleVideo}
        toggleAudio={studio.toggleAudio}
        switchCamera={studio.switchCamera}
        switchMicrophone={studio.switchMicrophone}
        toggleScreenShare={studio.toggleScreenShare}
        toggleSourceOnCanvas={studio.toggleSourceOnCanvas}
        switchLayout={studio.switchLayout}
        endSession={studio.endSession}
        guests={studio.guests}
        generateInviteLink={studio.generateInviteLink}
        admitGuest={studio.admitGuest}
        rejectGuest={studio.rejectGuest}
        removeGuest={studio.removeGuest}
      />
    </RealtimeKitProvider>
  )
}

// ── Guest view ────────────────────────────────────────────────────────────────
// Validates guestId belongs to the sessionId in the URL, then renders
// StudioConnected with stubs for host-only capabilities.

function GuestSessionView({
  sessionId,
  guestId,
}: {
  sessionId: string
  guestId: string
}) {
  const typedGuestId = guestId as Id<"studioGuests">
  const typedSessionId = sessionId as Id<"studioSessions">

  const guestRecord = useQuery(api.studio.getGuestStatus, { guestId: typedGuestId })
  const {
    status,
    error,
    client,
    cameras,
    microphones,
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,
    toggleScreenShare,
    leaveSession,
  } = useGuestStudio(typedGuestId)

  // Loading
  if (guestRecord === undefined) {
    return (
      <Shell>
        <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </Shell>
    )
  }

  // Invalid guestId or session mismatch
  if (guestRecord === null || guestRecord.sessionId !== typedSessionId) {
    return (
      <Shell>
        <p className="text-sm text-red-400">This invite link is not valid for this session.</p>
      </Shell>
    )
  }

  if (status === "removed") {
    return (
      <Shell>
        <p className="font-medium text-zinc-300">You have been removed from the studio.</p>
      </Shell>
    )
  }

  if (status === "error") {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error ?? "Failed to connect to studio"}</p>
      </Shell>
    )
  }

  if (status !== "connected" || !client) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4">
          <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
          <p className="text-sm text-zinc-400">
            {status === "loading" ? "Preparing studio…" : "Connecting to studio…"}
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <RealtimeKitProvider value={client}>
      <RtkParticipantsAudio />
      <StudioConnected
        compositorStream={null}
        sources={[]}
        onCanvasSlots={[]}
        activeLayoutId="solo"
        cameras={cameras}
        microphones={microphones}
        toggleVideo={toggleVideo}
        toggleAudio={toggleAudio}
        switchCamera={switchCamera}
        switchMicrophone={switchMicrophone}
        toggleScreenShare={toggleScreenShare}
        toggleSourceOnCanvas={(_sourceId: string) => {}}
        switchLayout={(_layoutId: string) => {}}
        endSession={leaveSession}
        guests={[]}
        generateInviteLink={async () => ""}
        admitGuest={async (_id: Id<"studioGuests">) => {}}
        rejectGuest={(_id: Id<"studioGuests">) => {}}
        removeGuest={(_id: Id<"studioGuests">) => {}}
      />
    </RealtimeKitProvider>
  )
}
```

**Important:** The `"use client"` directive applies to all client components in the file. In Next.js App Router, the server component (`StudioSessionPage`) and client components (`HostSessionView`, `GuestSessionView`) cannot be in the same file. Split them: keep the server shell in `page.tsx` and move both client views to a co-located `session-views.tsx` in the same directory, then import from `page.tsx`.

Revised structure:
- `app/studio/[sessionId]/page.tsx` — server component only, imports `HostSessionView`/`GuestSessionView`
- `app/studio/[sessionId]/session-views.tsx` — `"use client"`, defines `HostSessionView`, `GuestSessionView`, `Shell`

**`app/studio/[sessionId]/page.tsx`:**
```typescript
import { HostSessionView, GuestSessionView } from "./session-views"

export default async function StudioSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ guestId?: string }>
}) {
  const { sessionId } = await params
  const { guestId } = await searchParams

  if (guestId) {
    return <GuestSessionView sessionId={sessionId} guestId={guestId} />
  }
  return <HostSessionView sessionId={sessionId} />
}
```

**Note on file placement:** CLAUDE.md says feature components go in `components/`. `session-views.tsx` is placed in `app/studio/[sessionId]/` as a framework-forced exception — server and client components can't share a file in Next.js App Router, so the client views must live in a separate file co-located with the page. Do not treat this as a precedent for putting components in `app/`.

**`app/studio/[sessionId]/session-views.tsx`:**
```typescript
"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { RealtimeKitProvider } from "@cloudflare/realtimekit-react"
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useStudio } from "@/hooks/use-studio"
import { useGuestStudio } from "@/hooks/use-guest-studio"
import { StudioConnected } from "@/components/studio/studio-connected"
import type { Id } from "@/convex/_generated/dataModel"

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      {children}
    </div>
  )
}

export function HostSessionView({ sessionId: _sessionId }: { sessionId: string }) {
  const router = useRouter()
  const studio = useStudio()
  const { status, error, client, sessionLoaded } = studio

  useEffect(() => {
    if (status === "idle" && sessionLoaded && studio.sessionId === null) {
      router.replace("/studio")
    }
  }, [status, sessionLoaded, studio.sessionId, router])

  if (status === "error") {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error ?? "Failed to connect to studio"}</p>
        <a href="/studio" className="mt-2 text-sm text-zinc-400 underline">
          Back to Studio
        </a>
      </Shell>
    )
  }

  if (status !== "connected" || !client) {
    return (
      <Shell>
        <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </Shell>
    )
  }

  return (
    <RealtimeKitProvider value={client}>
      <RtkParticipantsAudio />
      <StudioConnected
        compositorStream={studio.compositorStream}
        sources={studio.sources}
        onCanvasSlots={studio.onCanvasSlots}
        activeLayoutId={studio.activeLayoutId}
        cameras={studio.cameras}
        microphones={studio.microphones}
        toggleVideo={studio.toggleVideo}
        toggleAudio={studio.toggleAudio}
        switchCamera={studio.switchCamera}
        switchMicrophone={studio.switchMicrophone}
        toggleScreenShare={studio.toggleScreenShare}
        toggleSourceOnCanvas={studio.toggleSourceOnCanvas}
        switchLayout={studio.switchLayout}
        endSession={studio.endSession}
        guests={studio.guests}
        generateInviteLink={studio.generateInviteLink}
        admitGuest={studio.admitGuest}
        rejectGuest={studio.rejectGuest}
        removeGuest={studio.removeGuest}
      />
    </RealtimeKitProvider>
  )
}

export function GuestSessionView({
  sessionId,
  guestId,
}: {
  sessionId: string
  guestId: string
}) {
  const typedGuestId = guestId as Id<"studioGuests">
  const typedSessionId = sessionId as Id<"studioSessions">

  const guestRecord = useQuery(api.studio.getGuestStatus, { guestId: typedGuestId })
  const {
    status,
    error,
    client,
    cameras,
    microphones,
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,
    toggleScreenShare,
    leaveSession,
  } = useGuestStudio(typedGuestId)

  // Note: useGuestStudio runs unconditionally (hooks can't be conditional) so RTK
  // init will be attempted even if the sessionId check below fails. This wastes one
  // Cloudflare Realtime slot for a deliberately crafted bad URL — acceptable edge case.

  if (guestRecord === undefined) {
    return (
      <Shell>
        <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </Shell>
    )
  }

  if (guestRecord === null || guestRecord.sessionId !== typedSessionId) {
    return (
      <Shell>
        <p className="text-sm text-red-400">This invite link is not valid for this session.</p>
      </Shell>
    )
  }

  if (status === "removed") {
    return (
      <Shell>
        <p className="font-medium text-zinc-300">You have been removed from the studio.</p>
      </Shell>
    )
  }

  if (status === "error") {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error ?? "Failed to connect to studio"}</p>
      </Shell>
    )
  }

  if (status !== "connected" || !client) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4">
          <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
          <p className="text-sm text-zinc-400">
            {status === "loading" ? "Preparing studio…" : "Connecting to studio…"}
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <RealtimeKitProvider value={client}>
      <RtkParticipantsAudio />
      <StudioConnected
        compositorStream={null}
        sources={[]}
        onCanvasSlots={[]}
        activeLayoutId="solo"
        cameras={cameras}
        microphones={microphones}
        toggleVideo={toggleVideo}
        toggleAudio={toggleAudio}
        switchCamera={switchCamera}
        switchMicrophone={switchMicrophone}
        toggleScreenShare={toggleScreenShare}
        toggleSourceOnCanvas={(_sourceId: string) => {}}
        switchLayout={(_layoutId: string) => {}}
        endSession={leaveSession}
        guests={[]}
        generateInviteLink={async () => ""}
        admitGuest={async (_id: Id<"studioGuests">) => {}}
        rejectGuest={(_id: Id<"studioGuests">) => {}}
        removeGuest={(_id: Id<"studioGuests">) => {}}
      />
    </RealtimeKitProvider>
  )
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/studio/\[sessionId\]/
git commit -m "feat: add unified /studio/[sessionId] page for host and guest"
```

---

### Task 5: Update guest redirect + delete old guest files (atomic)

**Files:**
- Modify: `components/studio/guest-join-view.tsx`
- Delete: `app/studio/guest/[guestId]/page.tsx`
- Delete: `components/studio/guest-studio-page.tsx`

These three changes must land in one commit. Admitted guests will be sent to the new URL; the old route must not exist at that point.

- [ ] **Step 1: Update `WaitingRoom` to thread `sessionId` through `onAdmitted`**

In `guest-join-view.tsx`, change the `WaitingRoom` prop type:

```typescript
// Before:
function WaitingRoom({
  guestId,
  onAdmitted,
  onRejected,
}: {
  guestId: Id<"studioGuests">
  onAdmitted: () => void
  onRejected: () => void
})

// After:
function WaitingRoom({
  guestId,
  onAdmitted,
  onRejected,
}: {
  guestId: Id<"studioGuests">
  onAdmitted: (sessionId: Id<"studioSessions">) => void
  onRejected: () => void
})
```

In the `useEffect` inside `WaitingRoom`, pass the sessionId when calling `onAdmitted`:

```typescript
// Before:
if (guest?.status === "admitted") {
  onAdmitted()
}

// After:
if (guest?.status === "admitted" && guest.sessionId) {
  onAdmitted(guest.sessionId)
}
```

- [ ] **Step 2: Replace `handleAdmitted` with an inline redirect**

The current `handleAdmitted` is a `useCallback` that reads `guestId` from the outer closure but receives no arguments (because the current `onAdmitted` is `() => void`). With the new `onAdmitted: (sessionId) => void` signature, we don't need a named callback at all — inline it in the waiting branch.

**Delete** the `handleAdmitted` `useCallback` declaration entirely.

In the `phase.step === "waiting"` render branch, replace:
```typescript
// Before:
<WaitingRoom
  guestId={guestId}
  onAdmitted={() => handleAdmitted(guestId)}
  onRejected={() => setPhase({ step: "rejected" })}
/>
```
with:
```typescript
// After:
<WaitingRoom
  guestId={guestId}
  onAdmitted={(sessionId) => router.push(`/studio/${sessionId}?guestId=${guestId}`)}
  onRejected={() => setPhase({ step: "rejected" })}
/>
```

where `guestId` is `phase.guestId` from the destructured `const { guestId } = phase` at the top of the waiting branch.

- [ ] **Step 3: Delete the old guest files**

```bash
rm app/studio/guest/\[guestId\]/page.tsx
rmdir app/studio/guest/\[guestId\]
rmdir app/studio/guest
rm components/studio/guest-studio-page.tsx
```

- [ ] **Step 4: Verify types and lint**

```bash
pnpm typecheck && pnpm lint
```
Expected: no errors. If there are unused import warnings in `guest-join-view.tsx` (e.g. `Id` from `dataModel`), remove them.

- [ ] **Step 5: Atomic commit**

```bash
git add components/studio/guest-join-view.tsx
git add -u app/studio/guest/ components/studio/guest-studio-page.tsx
git commit -m "feat: guest redirects to /studio/[sessionId], remove old guest route"
```

---

## Verification

After all tasks:

```bash
pnpm typecheck && pnpm lint
```

Manual test flow:
1. Go to `/studio` → click "Enter Studio" → should briefly show spinner → redirect to `/studio/[some-id]` → host studio loads
2. Open invite link → enter name → request join → host admits → guest lands on `/studio/[same-id]?guestId=xxx` → same studio UI
3. Guest can toggle camera, mic, screen share
4. Navigate directly to `/studio/[sessionId]` with no active session → should redirect to `/studio`
5. Guest with mismatched session URL → shows "not valid" error
