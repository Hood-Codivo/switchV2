"use client"

import { RealtimeKitProvider } from "@cloudflare/realtimekit-react"
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useStudio } from "@/hooks/use-studio"
import { useGuestStudio } from "@/hooks/use-guest-studio"
import { StudioConnected } from "@/components/studio/studio-connected"
import Link from "next/link"
import type { Id } from "@/convex/_generated/dataModel"

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      {children}
    </div>
  )
}

export function HostSessionView({ sessionId: _sessionId }: { sessionId: string }) {
  const studio = useStudio()
  const { status, error, client, sessionLoaded } = studio

  if (status === "idle" && sessionLoaded && studio.sessionId === null) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400">No active studio session.</p>
        <Link href="/studio" className="mt-2 text-sm text-zinc-400 underline">
          Back to Studio
        </Link>
      </Shell>
    )
  }

  if (status === "error") {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error ?? "Failed to connect to studio"}</p>
        <Link href="/studio" className="mt-2 text-sm text-zinc-400 underline">
          Back to Studio
        </Link>
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

  if (guestRecord === null || guestRecord.sessionId !== sessionId) {
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
