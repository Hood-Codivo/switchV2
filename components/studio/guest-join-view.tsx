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
