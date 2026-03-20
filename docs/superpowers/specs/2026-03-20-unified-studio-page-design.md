# Unified Studio Page Design

**Date:** 2026-03-20
**Status:** Approved

## Problem

Host and guest use separate pages (`/studio` and `/studio/guest/[guestId]`) with duplicated UI components and diverging experiences. The goal is a single in-session URL that serves both roles with an identical UI.

## Solution

Introduce `/studio/[sessionId]` as the unified in-session page. Role is detected from the presence of a `?guestId` query param. Both roles render the same `StudioConnected` component.

The pre-join flow at `/studio/join/[token]` remains unchanged — it is a distinct UX (name entry + waiting room) and does not belong in the studio page.

## URL Structure

```
/studio                           Host "Enter Studio" screen (unchanged)
/studio/[sessionId]               Host in-session view
/studio/[sessionId]?guestId=XXX   Guest in-session view
/studio/join/[token]              Pre-join flow (unchanged)
```

## Role Detection

The `[sessionId]` page reads the `?guestId` search param:

- **Present** → guest path: `GuestSessionView` validates `guestRecord.sessionId === sessionId`, then calls `useGuestStudio(guestId)`
- **Absent** → host path: `HostSessionView` calls `useStudio()`

## Data Normalization

Guest hook output is normalized to match `StudioConnectedProps` before reaching the UI. Stubs must satisfy TypeScript strict mode — all accept the correct argument types and are just no-ops.

| Field | Host value | Guest value |
|---|---|---|
| `compositorStream` | live MediaStream | `null` (shows placeholder) |
| `sources` | camera/screen sources | `[]` |
| `onCanvasSlots` | compositor slots | `[]` |
| `activeLayoutId` | active layout | `"solo"` (default, no-op) |
| `guests` | live guest list | `[]` |
| `generateInviteLink` | real | `async () => ""` |
| `admitGuest` | real | `async (_id: Id<"studioGuests">) => {}` |
| `rejectGuest` | real | `(_id: Id<"studioGuests">) => {}` |
| `removeGuest` | real | `(_id: Id<"studioGuests">) => {}` |
| `switchLayout` | real | `(_id: string) => {}` |
| `toggleSourceOnCanvas` | real | `(_id: string) => {}` |
| `toggleVideo/Audio` | real | real |
| `switchCamera/Mic` | real | real |
| `toggleScreenShare` | real | real |
| `endSession` | `endSession()` | mapped from `leaveSession()` |

## Changes Required

### convex/studio.ts

`createStudioSession` currently discards the return value of `ctx.runMutation(internal.studio.storeStudioSession, ...)`. Change it to capture and return the `sessionId`:

```ts
// Before
return { authToken: participant.token, roomId: meetingId }

// After
return { authToken: participant.token, roomId: meetingId, sessionId }
```

`storeStudioSession` requires no change — it already returns the inserted document ID.

### hooks/use-studio.ts

`sessionId` is already on `UseStudioReturn` and derived reactively from `getActiveSession`. No type changes needed.

**Race condition note:** After `startSession()` resolves, the Convex subscription for `getActiveSession` fires slightly later. The redirect in `HostSessionView` must watch `sessionId` reactively (i.e., `useEffect` on `sessionId`) rather than reading it immediately after calling `startSession()`. The session is created, then on the next subscription tick `sessionId` becomes non-null, and the effect fires `router.push`.

### components/studio/studio-view.tsx

This component currently owns the pre-join state machine (idle → connecting → connected). **Keep it as-is for the host entry flow at `/studio`.**

The only change: in the `status === "connected"` branch, add a `useEffect` that pushes to `/studio/${sessionId}` once `sessionId` is non-null. After the redirect, `/studio` is no longer rendered — the `[sessionId]` page takes over.

### components/studio/guest-join-view.tsx

Two changes:

1. **`WaitingRoom` callback signature**: Change `onAdmitted: () => void` to `onAdmitted: (sessionId: Id<"studioSessions">) => void`. The `WaitingRoom` already holds the `guest` record from `getGuestStatus` — pass `guest.sessionId` when calling `onAdmitted`.

2. **`handleAdmitted`**: Change signature to accept `sessionId` and update the redirect:
   ```ts
   // Before: router.push(`/studio/guest/${guestId}`)
   // After:
   router.push(`/studio/${sessionId}?guestId=${guestId}`)
   ```

### app/studio/[sessionId]/page.tsx (new)

Server component. Reads `sessionId` from params, `guestId` from `searchParams`. Conditionally renders `GuestSessionView` or `HostSessionView` (both defined as client components in the same file).

### GuestSessionView (client, co-located in [sessionId]/page.tsx)

1. Calls `useGuestStudio(guestId)`
2. Reads the guest record via `getGuestStatus`
3. **Validates** `guestRecord.sessionId === sessionId` — if mismatch, renders an error ("This invite link is not valid for this session")
4. Normalizes hook output to `StudioConnectedProps` using stubs from the table above
5. Renders `RealtimeKitProvider` + `StudioConnected`

**States to handle:** loading (while Convex resolves), error, removed, and connected.

### HostSessionView (client, co-located in [sessionId]/page.tsx)

**Edge case — direct navigation:** If the host navigates directly to `/studio/[sessionId]` (bookmark, reload), `useStudio()` starts with `status: "idle"`. `HostSessionView` must handle non-connected states:

- `"idle"` | `"requesting-session"` | `"connecting"` → redirect to `/studio` (let the pre-join state machine handle setup)
- `"error"` → render an inline error message with a link back to `/studio` (do not redirect silently — the user needs to see why they failed to connect)
- `"connected"` → render `StudioConnected` normally

This ensures `/studio` owns the setup flow while the `[sessionId]` page stays focused on the in-session state.

### Deleted (atomic with guest-join-view redirect change)

The following files must be deleted **in the same commit** as the `guest-join-view.tsx` redirect change to avoid a window where admitted guests hit a 404:

- `app/studio/guest/[guestId]/page.tsx`
- `components/studio/guest-studio-page.tsx`

## Out of Scope

- Role-based disabling of specific controls (layout picker, people panel actions)
- Guest canvas showing remote participant video tiles
- Participant self-view for guests
