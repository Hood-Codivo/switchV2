"use client"

import { useState } from "react"
import { Check, Copy, LogOut, MessageCircle, MessageSquare, Radio, UserMinus, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { STUDIO_LAYOUTS } from "@/lib/studio-layouts"
import type { StudioSource, StudioDevice, StudioGuest } from "@/hooks/use-studio"
import type { Id } from "@/convex/_generated/dataModel"
import { StudioBottomBar } from "./studio-bottom-bar"
import { StudioLayoutCanvas } from "./studio-layout-canvas"

// ─── Layout thumbnail ─────────────────────────────────────────────────────────

const LAYOUT_SVGS: Record<string, (c: string) => React.ReactNode> = {
  solo: (c) => <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.75" />,
  "side-by-side": (c) => (
    <>
      <rect x="1" y="1" width="12" height="16" rx="1.5" fill={c} opacity="0.75" />
      <rect x="15" y="1" width="12" height="16" rx="1.5" fill={c} opacity="0.75" />
    </>
  ),
  spotlight: (c) => (
    <>
      <rect x="1" y="1" width="18" height="16" rx="1.5" fill={c} opacity="0.75" />
      <rect x="21" y="1" width="6" height="7" rx="1" fill={c} opacity="0.5" />
      <rect x="21" y="10" width="6" height="7" rx="1" fill={c} opacity="0.5" />
    </>
  ),
  grid: (c) => (
    <>
      <rect x="1" y="1" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      <rect x="15" y="1" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      <rect x="1" y="10" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      <rect x="15" y="10" width="12" height="7" rx="1" fill={c} opacity="0.75" />
    </>
  ),
  "pip-br": (c) => (
    <>
      <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.35" />
      <rect x="17" y="10" width="9" height="6" rx="1" fill={c} opacity="0.9" />
    </>
  ),
  "pip-bl": (c) => (
    <>
      <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.35" />
      <rect x="2" y="10" width="9" height="6" rx="1" fill={c} opacity="0.9" />
    </>
  ),
  "sidebar-r": (c) => (
    <>
      <rect x="1" y="1" width="17" height="16" rx="1.5" fill={c} opacity="0.75" />
      <rect x="20" y="1" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
      <rect x="20" y="6.75" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
      <rect x="20" y="12.5" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
    </>
  ),
  fullscreen: (c) => (
    <rect x="0" y="0" width="28" height="18" rx="1.5" fill={c} opacity="0.75" />
  ),
}

function LayoutThumb({
  id,
  label,
  active,
  onClick,
}: {
  id: string
  label: string
  active: boolean
  onClick: () => void
}) {
  const svgFn = LAYOUT_SVGS[id]
  if (!svgFn) return null
  const color = active ? "white" : "#71717a"
  return (
    <button
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-11 items-center justify-center rounded transition-all",
        active ? "bg-zinc-700 ring-1 ring-zinc-500" : "hover:bg-zinc-800",
      )}
    >
      <svg viewBox="0 0 28 18" className="h-4 w-[28px]" fill="none">
        {svgFn(color)}
      </svg>
    </button>
  )
}

// ─── Sidebar empty state ──────────────────────────────────────────────────────

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

// ─── People panel ─────────────────────────────────────────────────────────────

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

  const waitingGuests  = guests.filter((g) => g.status === "waiting")
  const admittedGuests = guests.filter((g) => g.status === "admitted")

  async function handleCopyLink() {
    const link = await generateInviteLink()
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <button
        onClick={() => void handleCopyLink()}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-600 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
      >
        {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
        {copied ? "Link copied!" : "Copy invite link"}
      </button>

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

// ─── StudioConnected ──────────────────────────────────────────────────────────

type StudioConnectedProps = {
  // compositorStream is gone — StudioLayoutCanvas owns it now.
  // Instead we accept an optional callback so use-studio can still
  // get the stream for meeting.self.setVideoTrack().
  onCompositorStream?: (stream: MediaStream | null) => void
  sources: StudioSource[]
  onCanvasSlots: (StudioSource | null)[]
  activeLayoutId: string
  cameras: StudioDevice[]
  microphones: StudioDevice[]
  toggleVideo: () => Promise<void>
  toggleAudio: () => Promise<void>
  switchCamera: (deviceId: string) => Promise<void>
  switchMicrophone: (deviceId: string) => Promise<void>
  toggleScreenShare: () => Promise<void>
  toggleSourceOnCanvas: (sourceId: string) => void
  switchLayout: (layoutId: string) => void
  endSession: () => Promise<void>
  guests: StudioGuest[]
  generateInviteLink: () => Promise<string>
  admitGuest: (guestId: Id<"studioGuests">) => Promise<void>
  rejectGuest: (guestId: Id<"studioGuests">) => void
  removeGuest: (guestId: Id<"studioGuests">) => void
}

export function StudioConnected({
  onCompositorStream,
  sources,
  onCanvasSlots,
  activeLayoutId,
  cameras,
  microphones,
  toggleVideo,
  toggleAudio,
  switchCamera,
  switchMicrophone,
  toggleScreenShare,
  toggleSourceOnCanvas,
  switchLayout,
  endSession,
  guests,
  generateInviteLink,
  admitGuest,
  rejectGuest,
  removeGuest,
}: StudioConnectedProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("people")

  // Track whether we have a live compositor stream to enable Go Live
  const [hasCompositorStream, setHasCompositorStream] = useState(false)

  function handleCompositorStream(stream: MediaStream | null) {
    setHasCompositorStream(stream !== null)
    onCompositorStream?.(stream)
  }

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-zinc-950 text-white">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
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

      {/* ── Middle: canvas + sidebar ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* Canvas column */}
        <div className="flex min-w-0 flex-1 flex-col">

          {/* Preview area */}
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="w-full max-w-4xl">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/5">
                {/*
                  StudioLayoutCanvas replaces CompositorPreview.
                  It renders the layout tiles as visible <video> elements AND
                  simultaneously composites them onto a hidden <canvas>, emitting
                  a MediaStream via onCompositorStream.
                */}
                <StudioLayoutCanvas
                  slots={onCanvasSlots}
                  layoutId={activeLayoutId}
                  onCompositorStream={handleCompositorStream}
                />
              </div>
            </div>
          </div>

          {/* Layout picker */}
          <div className="flex h-12 flex-shrink-0 items-center gap-1 border-t border-zinc-800 bg-zinc-900 px-4">
            <span className="mr-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
              Layout
            </span>
            {STUDIO_LAYOUTS.map((l) => (
              <LayoutThumb
                key={l.id}
                id={l.id}
                label={l.label}
                active={activeLayoutId === l.id}
                onClick={() => switchLayout(l.id)}
              />
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
                {tab === "chat"     && <MessageCircle  className="size-3.5" />}
                {tab === "people"   && <Users          className="size-3.5" />}
                {tab}
              </button>
            ))}
          </div>

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
        </aside>
      </div>

      {/* ── Bottom strip ─────────────────────────────────────────────────── */}
      <StudioBottomBar
        sources={sources}
        onCanvasSlots={onCanvasSlots}
        cameras={cameras}
        microphones={microphones}
        toggleVideo={toggleVideo}
        toggleAudio={toggleAudio}
        switchCamera={switchCamera}
        switchMicrophone={switchMicrophone}
        toggleScreenShare={toggleScreenShare}
        toggleSourceOnCanvas={toggleSourceOnCanvas}
      />
    </div>
  )
}