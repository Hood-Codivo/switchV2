"use client"

import { useEffect } from "react"
import { RealtimeKitProvider } from "@cloudflare/realtimekit-react"
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui"
import { useQuery, useAction } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useStudio } from "@/hooks/use-studio"
import { useGuestStudio } from "@/hooks/use-guest-studio"
import { useGoLive } from "@/hooks/use-go-live"
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

export function HostSessionView() {
  const studio = useStudio()
  const { status, error, client, sessionLoaded } = studio
  const goLive = useGoLive(studio.sessionId, client)

  // Keep lastHeartbeatAt fresh on the active studio session so that any future
  // idle-session cleanup job can distinguish live sessions from abandoned ones.
  const sendHeartbeat = useAction(api.streams.heartbeat)
  useEffect(() => {
    if (status !== "connected") return
    void sendHeartbeat({})
    const interval = setInterval(() => { void sendHeartbeat({}) }, 30_000)
    return () => clearInterval(interval)
    // sendHeartbeat is a stable Convex mutation reference — omitted from deps intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

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
        onCompositorStream={studio.setCompositorStream}
        sessionId={studio.sessionId!}
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
        liveState={goLive.liveState}
        viewerCount={goLive.viewerCount}
        health={goLive.health}
        onGoLive={goLive.goLive}
        onEndStream={goLive.endStream}
        isHost={true}
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
  const guest = useGuestStudio(typedGuestId)
  const { status, error, client, cameras, microphones, toggleVideo, toggleAudio,
          switchCamera, switchMicrophone, toggleScreenShare, leaveSession } = guest

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

  if (status === "idle") {
    return (
      <Shell>
        <p className="font-medium text-zinc-300">You have left the studio.</p>
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
        onCompositorStream={guest.setCompositorStream}
        sessionId={guestRecord.sessionId}
        guestId={typedGuestId}
        sources={guest.sources}
        onCanvasSlots={guest.onCanvasSlots}
        activeLayoutId={guest.activeLayoutId}
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
        liveState={"idle" as const}
        viewerCount={0}
        health={null}
        onGoLive={async () => {}}
        onEndStream={async () => {}}
        isHost={false}
      />
    </RealtimeKitProvider>
  )
}
