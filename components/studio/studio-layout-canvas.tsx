"use client"

/**
 * StudioLayoutCanvas
 *
 * Replaces CompositorPreview. Does two jobs simultaneously:
 *
 *  1. VISUAL PREVIEW — renders each slot as a positioned <video> tile
 *     laid out according to the active layout (solo, grid, pip-br, etc.)
 *
 *  2. CANVAS COMPOSITOR — a hidden <canvas> that an rAF loop draws
 *     those same video elements onto. canvas.captureStream(30) is emitted
 *     via onCompositorStream so the caller can push it to RTK guests with
 *     meeting.self.setVideoTrack(stream.getVideoTracks()[0]).
 *
 * Slot geometry mirrors the SVG thumbnails in LAYOUT_SVGS exactly so the
 * preview matches the layout-picker icons.
 */

import { useEffect, useLayoutEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { StudioSource } from "@/hooks/use-studio"

// ─── Canvas output resolution ─────────────────────────────────────────────────

const OUT_W = 1280
const OUT_H = 720

// ─── Normalised slot rects ────────────────────────────────────────────────────
// [left, top, width, height] all in 0..1 range, matching LAYOUT_SVGS proportions.

type NRect = [l: number, t: number, w: number, h: number]

const LAYOUT_RECTS: Record<string, NRect[]> = {
  solo: [
    [0, 0, 1, 1],
  ],
  "side-by-side": [
    [0,        0, 0.4975, 1],
    [0.5025,   0, 0.4975, 1],
  ],
  spotlight: [
    [0,      0,       0.662,  1     ],
    [0.668,  0,       0.332,  0.4975],
    [0.668,  0.5025,  0.332,  0.4975],
  ],
  grid: [
    [0,       0,       0.4975, 0.4975],
    [0.5025,  0,       0.4975, 0.4975],
    [0,       0.5025,  0.4975, 0.4975],
    [0.5025,  0.5025,  0.4975, 0.4975],
  ],
  "pip-br": [
    [0,      0,      1,      1     ],
    [0.718,  0.665,  0.268,  0.308 ],
  ],
  "pip-bl": [
    [0,      0,      1,      1     ],
    [0.014,  0.665,  0.268,  0.308 ],
  ],
  "sidebar-r": [
    [0,      0,       0.66,   1     ],
    [0.668,  0,       0.332,  0.331 ],
    [0.668,  0.3345,  0.332,  0.331 ],
    [0.668,  0.669,   0.332,  0.331 ],
  ],
  fullscreen: [
    [0, 0, 1, 1],
  ],
}

/** Layouts where slot[1] is a floating PIP overlay on top of slot[0]. */
const PIP_LAYOUTS = new Set(["pip-br", "pip-bl"])

// ─── Props ────────────────────────────────────────────────────────────────────

interface StudioLayoutCanvasProps {
  /** Ordered array matching layout slots. Index 0 = primary/background. */
  slots: (StudioSource | null)[]
  /** Layout id — must match a key in LAYOUT_RECTS (and in STUDIO_LAYOUTS). */
  layoutId: string
  /**
   * Fires when the canvas MediaStream is available (on mount) or null (unmount).
   * Wire this into meeting.self.setVideoTrack() to broadcast the compositor
   * output to RTK guests.
   */
  onCompositorStream?: (stream: MediaStream | null) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StudioLayoutCanvas({
  slots,
  layoutId,
  onCompositorStream,
}: StudioLayoutCanvasProps) {
  // Keep callback ref stable so the stream-bootstrap effect never re-fires
  const onStreamRef = useRef(onCompositorStream)
  useEffect(() => { onStreamRef.current = onCompositorStream }, [onCompositorStream])

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  // videoRefs[i] feeds both the visible tile AND the canvas draw source
  const videoRefs   = useRef<(HTMLVideoElement | null)[]>([])
  const rafRef      = useRef<number>(0)

  const rects = LAYOUT_RECTS[layoutId] ?? LAYOUT_RECTS.solo
  const isPip = PIP_LAYOUTS.has(layoutId)

  // ── 1. Bootstrap canvas → MediaStream (once, on mount) ──────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const stream = canvas.captureStream(30)
    onStreamRef.current?.(stream)
    return () => { onStreamRef.current?.(null) }
  }, []) // intentionally empty

  // ── 2. rAF draw loop ─────────────────────────────────────────────────────
  // "Latest ref" pattern: useLayoutEffect (no deps) runs synchronously after
  // every render so drawRef.current always holds the freshest closure before
  // the next animation frame fires — no self-reference, no loop restarts.
  const drawRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current
      const ctx    = canvas?.getContext("2d")

      if (ctx) {
        // Background
        ctx.fillStyle = "#09090b"
        ctx.fillRect(0, 0, OUT_W, OUT_H)

        rects.forEach(([nl, nt, nw, nh], i) => {
          const video = videoRefs.current[i]
          if (!video || !slots[i] || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return

          const dx = Math.round(nl * OUT_W)
          const dy = Math.round(nt * OUT_H)
          const dw = Math.round(nw * OUT_W)
          const dh = Math.round(nh * OUT_H)

          // object-cover: scale to fill, centre-crop excess
          const vw    = video.videoWidth  || 1
          const vh    = video.videoHeight || 1
          const scale = Math.max(dw / vw, dh / vh)
          const sw    = dw / scale
          const sh    = dh / scale
          const sx    = (vw - sw) / 2
          const sy    = (vh - sh) / 2

          ctx.save()

          // PIP overlay: rounded clip + drop shadow
          if (isPip && i === 1) {
            ctx.shadowColor = "rgba(0,0,0,0.65)"
            ctx.shadowBlur  = 14
            ctx.beginPath()
            ctx.roundRect(dx, dy, dw, dh, 6)
            ctx.clip()
          }

          ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
          ctx.restore()

          // PIP border (drawn outside clip so it's not cropped)
          if (isPip && i === 1) {
            ctx.save()
            ctx.strokeStyle = "rgba(255,255,255,0.22)"
            ctx.lineWidth   = 2
            ctx.beginPath()
            ctx.roundRect(dx, dy, dw, dh, 6)
            ctx.stroke()
            ctx.restore()
          }
        })
      }

      // Call through the ref so each frame picks up the latest closure
      rafRef.current = requestAnimationFrame(() => drawRef.current())
    }
  })

  // Start the loop once on mount; cleanup on unmount
  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => drawRef.current())
    return () => cancelAnimationFrame(rafRef.current!)
  }, [])

  // ── 3. Sync video srcObjects when slots or layout changes ────────────────
  useEffect(() => {
    rects.forEach((_, i) => {
      const video = videoRefs.current[i]
      if (!video) return
      const track = slots[i]?.track ?? null
      // Wrap the track in a MediaStream; video.srcObject requires MediaStream, not MediaStreamTrack
      const nextStream = track ? new MediaStream([track]) : null
      // Avoid re-assigning if the single track inside the existing stream is the same
      const prevTrack = video.srcObject instanceof MediaStream
        ? (video.srcObject.getVideoTracks()[0] ?? null)
        : null
      if (prevTrack === track) return
      video.srcObject = nextStream
      if (nextStream) void video.play().catch(() => {})
    })
  }, [slots, rects])

  // ── 4. Trim stale refs when layout shrinks the slot count ────────────────
  useEffect(() => {
    videoRefs.current = videoRefs.current.slice(0, rects.length)
  }, [rects.length])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const hasAny = slots.some(Boolean)

  return (
    <div className="relative size-full overflow-hidden bg-zinc-950">

      {/* Hidden compositor canvas — captureStream source */}
      <canvas
        ref={canvasRef}
        width={OUT_W}
        height={OUT_H}
        className="hidden"
        aria-hidden
      />

      {/* ── Layout tiles ──────────────────────────────────────────────── */}
      {rects.map(([nl, nt, nw, nh], i) => {
        const source    = slots[i] ?? null
        const isPipTile = isPip && i === 1

        return (
          <div
            key={i}
            className={cn(
              "absolute overflow-hidden bg-zinc-900 transition-all duration-200",
              isPipTile
                ? "rounded-md shadow-[0_4px_28px_rgba(0,0,0,0.75)] ring-1 ring-white/20"
                : "ring-1 ring-white/6",
              !source && "opacity-40",
            )}
            style={{
              left:   `${nl * 100}%`,
              top:    `${nt * 100}%`,
              width:  `${nw * 100}%`,
              height: `${nh * 100}%`,
              zIndex: isPipTile ? 10 : i + 1,
            }}
          >
            {source ? (
              <div className="group relative size-full">
                {/* Video element — shared with canvas compositor */}
                <video
                  ref={el => { videoRefs.current[i] = el }}
                  muted
                  autoPlay
                  playsInline
                  className="size-full object-cover"
                />

                {/* Source label badge */}
                <div
                  className={cn(
                    "absolute bottom-1.5 left-1.5 max-w-[80%] truncate rounded",
                    "bg-black/60 px-1.5 py-px",
                    "text-[10px] font-medium leading-4 text-zinc-300",
                    // Always visible on PIP (too small to hover); fade in on larger tiles
                  )}
                >
                  {source.label}
                </div>
              </div>
            ) : (
              /* Empty slot placeholder */
              <div className="flex size-full flex-col items-center justify-center gap-1.5" />
            )}
          </div>
        )
      })}

      {/* ── Global empty state ─────────────────────────────────────────── */}
      {!hasAny && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <p className="text-xs text-zinc-600">No sources on stage</p>
        </div>
      )}

      {/* Resolution badge */}
      <div className="pointer-events-none absolute left-2 top-2 z-30 select-none text-[9px] font-mono text-zinc-700">
        720p
      </div>
    </div>
  )
}