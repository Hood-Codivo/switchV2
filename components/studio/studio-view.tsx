"use client"

import { useEffect, useRef } from "react"
import { useStudio } from "@/hooks/use-studio"
import { cn } from "@/lib/utils"

// ─── Icons (inline SVG to avoid adding lucide overhead for just these) ───────

function MicIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function CameraIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
      <path d="M22 3L2 21" />
      <path d="M22 7.5V16a2 2 0 0 1-.36 1.14" />
      <polyline points="17 7 22 7 22 11" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}

// ─── Local video preview tile ─────────────────────────────────────────────

function LocalVideoTile({
  track,
  enabled,
}: {
  track: MediaStreamTrack | null
  enabled: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!videoRef.current) return
    if (track && enabled) {
      videoRef.current.srcObject = new MediaStream([track])
      videoRef.current.play().catch(() => {})
    } else {
      videoRef.current.srcObject = null
    }
  }, [track, enabled])

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
      {enabled && track ? (
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className="size-full object-cover scale-x-[-1]"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <span className="text-sm text-muted-foreground">Camera off</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
        You (preview)
      </div>
    </div>
  )
}

// ─── Device selector ──────────────────────────────────────────────────────

function DeviceSelector({
  label,
  devices,
  onSelect,
}: {
  label: string
  devices: { deviceId: string; label: string }[]
  onSelect: (deviceId: string) => Promise<void>
}) {
  if (devices.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <select
        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
        onChange={(e) => void onSelect(e.target.value)}
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Control bar ──────────────────────────────────────────────────────────

function ControlButton({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-destructive/20 text-destructive hover:bg-destructive/30",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

// ─── Main studio view ─────────────────────────────────────────────────────

export function StudioView() {
  const {
    status,
    error,
    localVideoTrack,
    videoEnabled,
    audioEnabled,
    cameras,
    microphones,
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,
    shareScreen,
    startSession,
    endSession,
  } = useStudio()

  const isConnecting = status === "requesting-session" || status === "connecting"
  const isConnected = status === "connected"

  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">Studio</h1>
        {isConnected && (
          <button
            onClick={() => void endSession()}
            className="rounded bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            Leave Studio
          </button>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
        {/* Idle / pre-join */}
        {status === "idle" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">Ready to go live? Join the studio to get started.</p>
            <button
              onClick={() => void startSession()}
              className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Enter Studio
            </button>
          </div>
        )}

        {/* Connecting */}
        {isConnecting && (
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Setting up your studio…</p>
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => void startSession()}
              className="rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Connected — studio layout */}
        {isConnected && (
          <div className="flex w-full max-w-5xl flex-col gap-6">
            {/* Video preview */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <LocalVideoTile track={localVideoTrack} enabled={videoEnabled} />
            </div>

            {/* Control bar */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <ControlButton
                active={audioEnabled}
                onClick={() => void toggleAudio()}
                label={audioEnabled ? "Mute" : "Unmute"}
              >
                <MicIcon muted={!audioEnabled} />
              </ControlButton>

              <ControlButton
                active={videoEnabled}
                onClick={() => void toggleVideo()}
                label={videoEnabled ? "Stop Camera" : "Start Camera"}
              >
                <CameraIcon off={!videoEnabled} />
              </ControlButton>

              <button
                onClick={() => void shareScreen()}
                className="flex items-center gap-1.5 rounded-full bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/80"
              >
                Share Screen
              </button>
            </div>

            {/* Device selectors */}
            <div className="flex flex-wrap gap-6">
              <DeviceSelector
                label="Camera"
                devices={cameras}
                onSelect={switchCamera}
              />
              <DeviceSelector
                label="Microphone"
                devices={microphones}
                onSelect={switchMicrophone}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
