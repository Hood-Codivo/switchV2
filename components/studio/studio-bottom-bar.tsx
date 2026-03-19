"use client"

import { useEffect, useRef, useState } from "react"
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Settings,
  ChevronUp,
  UserPlus,
  Radio,
} from "lucide-react"
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react"
import { cn } from "@/lib/utils"
import type { StudioDevice } from "@/hooks/use-studio"

// ─── Device selection dropdown ────────────────────────────────────────────────

function DeviceMenu({
  devices,
  onSelect,
  onClose,
}: {
  devices: StudioDevice[]
  onSelect: (deviceId: string) => Promise<void>
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-20 mb-2 min-w-56 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-2xl">
        {devices.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">No devices found</p>
        ) : (
          devices.map((d) => (
            <button
              key={d.deviceId}
              onClick={() => {
                void onSelect(d.deviceId)
                onClose()
              }}
              className="flex w-full items-center px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              {d.label}
            </button>
          ))
        )}
      </div>
    </>
  )
}

// ─── Source strip tile ────────────────────────────────────────────────────────

function SourceTile({
  videoTrack,
  label,
  audioEnabled,
  videoEnabled,
}: {
  videoTrack: MediaStreamTrack | null
  label: string
  audioEnabled: boolean
  videoEnabled: boolean
}) {
  return (
    <div className="relative aspect-video w-36 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800 ring-2 ring-blue-500/50">
      {videoEnabled && videoTrack ? (
        // useEffect is required: setting srcObject is an imperative browser API
        <LocalVideoEl track={videoTrack} />
      ) : (
        <div className="flex size-full items-center justify-center">
          <div className="flex size-9 items-center justify-center rounded-full bg-zinc-700 text-sm font-semibold text-zinc-300">
            {label[0]?.toUpperCase() ?? "?"}
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <span className="text-[10px] font-medium text-white">{label}</span>
      </div>
      {!audioEnabled && (
        <div className="absolute left-1.5 top-1.5 rounded bg-red-600/90 p-0.5">
          <MicOff className="size-2.5 text-white" />
        </div>
      )}
    </div>
  )
}

// ─── Local video element (mirrored, bound to a track) ─────────────────────────
// useEffect is required: setting srcObject is an imperative browser API.

function LocalVideoEl({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = new MediaStream([track])
    void ref.current.play().catch(() => {})
  }, [track])

  return (
    <video
      ref={ref}
      muted
      autoPlay
      playsInline
      className="size-full object-cover [transform:scaleX(-1)]"
    />
  )
}

// ─── Bottom bar ────────────────────────────────────────────────────────────────

type StudioBottomBarProps = {
  cameras: StudioDevice[]
  microphones: StudioDevice[]
  toggleVideo: () => Promise<void>
  toggleAudio: () => Promise<void>
  switchCamera: (deviceId: string) => Promise<void>
  switchMicrophone: (deviceId: string) => Promise<void>
  shareScreen: () => Promise<void>
}

export function StudioBottomBar({
  cameras,
  microphones,
  toggleVideo,
  toggleAudio,
  switchCamera,
  switchMicrophone,
  shareScreen,
}: StudioBottomBarProps) {
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled)
  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled)
  const videoTrack = useRealtimeKitSelector((m) => m.self.videoTrack ?? null)

  const [showCameraMenu, setShowCameraMenu] = useState(false)
  const [showMicMenu, setShowMicMenu] = useState(false)

  return (
    <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900">
      {/* Source tiles */}
      <div className="flex items-center gap-3 overflow-x-auto px-4 py-3">
        <SourceTile
          videoTrack={videoTrack}
          label="You"
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
        />
        <button className="flex aspect-video w-36 flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-zinc-700 text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-400">
          <UserPlus className="size-5" />
          <span className="text-[10px] font-medium">Present or invite</span>
        </button>
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between px-4 pb-4">
        <div className="flex items-center gap-2">
          {/* Mic group */}
          <div className="relative flex">
            <button
              onClick={() => void toggleAudio()}
              className={cn(
                "flex items-center justify-center rounded-l-full px-3.5 py-2.5 transition-colors",
                audioEnabled
                  ? "bg-zinc-700 text-white hover:bg-zinc-600"
                  : "bg-red-600/20 text-red-400 hover:bg-red-600/30",
              )}
            >
              {audioEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </button>
            <button
              onClick={() => {
                setShowMicMenu((v) => !v)
                setShowCameraMenu(false)
              }}
              className={cn(
                "flex items-center justify-center rounded-r-full border-l px-2 py-2.5 transition-colors",
                audioEnabled
                  ? "border-zinc-600 bg-zinc-700 hover:bg-zinc-600"
                  : "border-red-900/40 bg-red-600/20 hover:bg-red-600/30",
              )}
            >
              <ChevronUp
                className={cn(
                  "size-3 text-zinc-400 transition-transform duration-150",
                  showMicMenu && "rotate-180",
                )}
              />
            </button>
            {showMicMenu && (
              <DeviceMenu
                devices={microphones}
                onSelect={switchMicrophone}
                onClose={() => setShowMicMenu(false)}
              />
            )}
          </div>

          {/* Camera group */}
          <div className="relative flex">
            <button
              onClick={() => void toggleVideo()}
              className={cn(
                "flex items-center justify-center rounded-l-full px-3.5 py-2.5 transition-colors",
                videoEnabled
                  ? "bg-zinc-700 text-white hover:bg-zinc-600"
                  : "bg-red-600/20 text-red-400 hover:bg-red-600/30",
              )}
            >
              {videoEnabled ? <Video className="size-4" /> : <VideoOff className="size-4" />}
            </button>
            <button
              onClick={() => {
                setShowCameraMenu((v) => !v)
                setShowMicMenu(false)
              }}
              className={cn(
                "flex items-center justify-center rounded-r-full border-l px-2 py-2.5 transition-colors",
                videoEnabled
                  ? "border-zinc-600 bg-zinc-700 hover:bg-zinc-600"
                  : "border-red-900/40 bg-red-600/20 hover:bg-red-600/30",
              )}
            >
              <ChevronUp
                className={cn(
                  "size-3 text-zinc-400 transition-transform duration-150",
                  showCameraMenu && "rotate-180",
                )}
              />
            </button>
            {showCameraMenu && (
              <DeviceMenu
                devices={cameras}
                onSelect={switchCamera}
                onClose={() => setShowCameraMenu(false)}
              />
            )}
          </div>

          {/* Screen share */}
          <button
            onClick={() => void shareScreen()}
            className="flex items-center justify-center rounded-full bg-zinc-700 px-3.5 py-2.5 text-white transition-colors hover:bg-zinc-600"
          >
            <Monitor className="size-4" />
          </button>

          {/* Settings */}
          <button className="flex items-center justify-center rounded-full p-2.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300">
            <Settings className="size-4" />
          </button>
        </div>

        {/* Go Live — disabled stub */}
        <button
          disabled
          className="flex cursor-not-allowed items-center gap-2 rounded-full bg-red-600/25 px-7 py-2.5 text-sm font-semibold text-red-400 opacity-50"
        >
          <Radio className="size-4" />
          Go Live
        </button>
      </div>
    </div>
  )
}
