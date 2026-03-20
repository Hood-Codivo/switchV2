"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

// ── Types ────────────────────────────────────────────────────────────────────

type JoinPhase =
  | { step: "enter-name" }
  | { step: "waiting"; guestId: Id<"studioGuests"> }
  | { step: "rejected" }
  | { step: "error"; message: string }

// ── Waiting room ──────────────────────────────────────────────────────────────
// Subscribes to the guest record via Convex and fires callbacks when the host
// admits or rejects. useEffect is required: subscription change → side effect.

function WaitingRoom({
  guestId,
  onAdmitted,
  onRejected,
}: {
  guestId: Id<"studioGuests">
  onAdmitted: (sessionId: Id<"studioSessions">) => void
  onRejected: () => void
}) {
  const guest = useQuery(api.studio.getGuestStatus, { guestId })

  useEffect(() => {
    if (guest?.status === "admitted" && guest.sessionId) {
      onAdmitted(guest.sessionId)
    } else if (guest?.status === "rejected") {
      onRejected()
    }
  }, [guest?.status, guest?.sessionId, onAdmitted, onRejected])

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

// ── Main component ────────────────────────────────────────────────────────────

export function GuestJoinView({ token }: { token: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<JoinPhase>({ step: "enter-name" })
  const [displayName, setDisplayName] = useState("")

  const tokenInfo = useQuery(api.studio.getSessionByInviteToken, { token })
  const requestJoin = useMutation(api.studio.requestGuestJoin)

  // Token still loading
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
          onAdmitted={(sessionId) => router.push(`/studio/${sessionId}?guestId=${guestId}`)}
          onRejected={() => setPhase({ step: "rejected" })}
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
