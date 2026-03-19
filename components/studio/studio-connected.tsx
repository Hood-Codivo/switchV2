"use client"

import { useEffect, useRef, useState } from "react"
import { LogOut, MessageCircle, MessageSquare, Radio, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StudioDevice } from "@/hooks/use-studio"
import { StudioBottomBar } from "./studio-bottom-bar"

// ─── Video element ────────────────────────────────────────────────────────────
// useEffect is required: setting srcObject is an imperative browser API
// with no declarative React equivalent (Canvas/WebRTC exception in CLAUDE.md).

function VideoEl({
  source,
  className,
}: {
  source: MediaStream | null | undefined
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = source ?? null
    if (source) void ref.current.play().catch(() => {})
  }, [source])

  return <video ref={ref} muted autoPlay playsInline className={className} />
}

// ─── Layout preset thumbnails ─────────────────────────────────────────────────

const LAYOUTS = [
  {
    id: "solo",
    label: "Solo",
    svg: (c: string) => (
      <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.75" />
    ),
  },
  {
    id: "side-by-side",
    label: "Side by side",
    svg: (c: string) => (
      <>
        <rect x="1" y="1" width="12" height="16" rx="1.5" fill={c} opacity="0.75" />
        <rect x="15" y="1" width="12" height="16" rx="1.5" fill={c} opacity="0.75" />
      </>
    ),
  },
  {
    id: "spotlight",
    label: "Spotlight",
    svg: (c: string) => (
      <>
        <rect x="1" y="1" width="18" height="16" rx="1.5" fill={c} opacity="0.75" />
        <rect x="21" y="1" width="6" height="7" rx="1" fill={c} opacity="0.5" />
        <rect x="21" y="10" width="6" height="7" rx="1" fill={c} opacity="0.5" />
      </>
    ),
  },
  {
    id: "grid",
    label: "Grid",
    svg: (c: string) => (
      <>
        <rect x="1" y="1" width="12" height="7" rx="1" fill={c} opacity="0.75" />
        <rect x="15" y="1" width="12" height="7" rx="1" fill={c} opacity="0.75" />
        <rect x="1" y="10" width="12" height="7" rx="1" fill={c} opacity="0.75" />
        <rect x="15" y="10" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      </>
    ),
  },
  {
    id: "pip-br",
    label: "PiP Bottom Right",
    svg: (c: string) => (
      <>
        <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.35" />
        <rect x="17" y="10" width="9" height="6" rx="1" fill={c} opacity="0.9" />
      </>
    ),
  },
  {
    id: "pip-bl",
    label: "PiP Bottom Left",
    svg: (c: string) => (
      <>
        <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.35" />
        <rect x="2" y="10" width="9" height="6" rx="1" fill={c} opacity="0.9" />
      </>
    ),
  },
  {
    id: "sidebar-r",
    label: "Sidebar Right",
    svg: (c: string) => (
      <>
        <rect x="1" y="1" width="17" height="16" rx="1.5" fill={c} opacity="0.75" />
        <rect x="20" y="1" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
        <rect x="20" y="6.75" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
        <rect x="20" y="12.5" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
      </>
    ),
  },
  {
    id: "fullscreen",
    label: "Fullscreen",
    svg: (c: string) => (
      <rect x="0" y="0" width="28" height="18" rx="1.5" fill={c} opacity="0.75" />
    ),
  },
]

function LayoutThumb({ id, label, active }: { id: string; label: string; active: boolean }) {
  const layout = LAYOUTS.find((l) => l.id === id)
  if (!layout) return null
  const color = active ? "white" : "#71717a"
  return (
    <button
      title={label}
      className={cn(
        "flex h-8 w-11 items-center justify-center rounded transition-all",
        active ? "bg-zinc-700 ring-1 ring-zinc-500" : "hover:bg-zinc-800",
      )}
    >
      <svg viewBox="0 0 28 18" className="h-4 w-[28px]" fill="none">
        {layout.svg(color)}
      </svg>
    </button>
  )
}

// ─── Sidebar tab empty state ──────────────────────────────────────────────────

type SidebarTab = "comments" | "chat" | "people"

function SidebarEmpty({ tab }: { tab: SidebarTab }) {
  const config = {
    comments: {
      icon: <MessageSquare className="size-8 text-zinc-700" />,
      title: "Comments",
      body: "Viewer comments appear here once you go live.",
    },
    chat: {
      icon: <MessageCircle className="size-8 text-zinc-700" />,
      title: "Private Chat",
      body: "Backstage chat with your guests.",
    },
    people: {
      icon: <Users className="size-8 text-zinc-700" />,
      title: "People",
      body: "Guests will appear here after joining via invite.",
    },
  }[tab]

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {config.icon}
      <div>
        <p className="text-sm font-medium text-zinc-500">{config.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-700">{config.body}</p>
      </div>
    </div>
  )
}

// ─── Connected studio layout ──────────────────────────────────────────────────

type StudioConnectedProps = {
  compositorStream: MediaStream | null
  cameras: StudioDevice[]
  microphones: StudioDevice[]
  toggleVideo: () => Promise<void>
  toggleAudio: () => Promise<void>
  switchCamera: (deviceId: string) => Promise<void>
  switchMicrophone: (deviceId: string) => Promise<void>
  shareScreen: () => Promise<void>
  endSession: () => Promise<void>
}

export function StudioConnected({
  compositorStream,
  cameras,
  microphones,
  toggleVideo,
  toggleAudio,
  switchCamera,
  switchMicrophone,
  shareScreen,
  endSession,
}: StudioConnectedProps) {
  const [activeLayout, setActiveLayout] = useState("side-by-side")
  const [activeTab, setActiveTab] = useState<SidebarTab>("people")

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-zinc-950 text-white">
      {/* ── Top bar ── */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Studio</span>
          <div className="h-3.5 w-px bg-zinc-700" />
          <span className="text-xs text-zinc-500">Not live</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            className="flex cursor-not-allowed items-center gap-1.5 rounded bg-red-600/25 px-3 py-1.5 text-xs font-semibold text-red-400 opacity-50"
          >
            <Radio className="size-3" />
            Go Live
          </button>
          <button
            onClick={() => void endSession()}
            className="flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            <LogOut className="size-3" />
            Leave
          </button>
        </div>
      </header>

      {/* ── Middle: canvas + sidebar ── */}
      <div className="flex min-h-0 flex-1">
        {/* Canvas + layout picker */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="w-full max-w-4xl">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900 shadow-2xl ring-1 ring-white/5">
                {compositorStream ? (
                  <VideoEl source={compositorStream} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <p className="text-xs text-zinc-600">No sources on stage</p>
                  </div>
                )}
                <div className="absolute left-3 top-3 text-[10px] font-mono text-zinc-600">
                  720p
                </div>
              </div>
            </div>
          </div>

          {/* Layout picker */}
          <div className="flex h-12 flex-shrink-0 items-center gap-1 border-t border-zinc-800 bg-zinc-900 px-4">
            <span className="mr-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
              Layout
            </span>
            {LAYOUTS.map((l) => (
              <button key={l.id} onClick={() => setActiveLayout(l.id)}>
                <LayoutThumb id={l.id} label={l.label} active={activeLayout === l.id} />
              </button>
            ))}
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="flex w-72 flex-shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
          <div className="flex border-b border-zinc-800">
            {(["comments", "chat", "people"] as SidebarTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium capitalize transition-colors",
                  activeTab === tab
                    ? "border-b-2 border-white text-white"
                    : "text-zinc-600 hover:text-zinc-400",
                )}
              >
                {tab === "comments" && <MessageSquare className="size-3.5" />}
                {tab === "chat" && <MessageCircle className="size-3.5" />}
                {tab === "people" && <Users className="size-3.5" />}
                {tab}
              </button>
            ))}
          </div>
          <SidebarEmpty tab={activeTab} />
        </aside>
      </div>

      {/* ── Bottom strip ── */}
      <StudioBottomBar
        cameras={cameras}
        microphones={microphones}
        toggleVideo={toggleVideo}
        toggleAudio={toggleAudio}
        switchCamera={switchCamera}
        switchMicrophone={switchMicrophone}
        shareScreen={shareScreen}
      />
    </div>
  )
}
