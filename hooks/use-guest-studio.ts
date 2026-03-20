"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import RTKClient from "@cloudflare/realtimekit"
import type { Id } from "@/convex/_generated/dataModel"
import type { StudioDevice, StudioSource } from "./use-studio"
import { STUDIO_LAYOUT_MAP, DEFAULT_LAYOUT_ID } from "@/lib/studio-layouts"
import type { LayoutConfig } from "@/lib/studio-layouts"

// ─── Video element cache (same pattern as use-studio) ────────────────────────

type VideoElEntry = { el: HTMLVideoElement; track: MediaStreamTrack }

function getOrCreateVideoEl(
  cache: Map<string, VideoElEntry>,
  source: StudioSource,
): HTMLVideoElement | null {
  if (!source.videoEnabled || !source.track) return null

  const entry = cache.get(source.id)
  if (entry) {
    if (entry.track !== source.track) {
      entry.el.srcObject = new MediaStream([source.track])
      void entry.el.play().catch(() => {})
      cache.set(source.id, { el: entry.el, track: source.track })
    }
    return entry.el
  }

  const el = document.createElement("video")
  el.muted = true
  el.srcObject = new MediaStream([source.track])
  void el.play().catch(() => {})
  cache.set(source.id, { el, track: source.track })
  return el
}

function cleanupStaleVideoEls(cache: Map<string, VideoElEntry>, currentIds: Set<string>) {
  cache.forEach((entry, id) => {
    if (!currentIds.has(id)) {
      entry.el.srcObject = null
      cache.delete(id)
    }
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuestStudioStatus =
  | "loading"     // waiting for RTK token from Convex
  | "connecting"  // RTKClient.init + join in progress
  | "connected"   // in the meeting
  | "removed"     // host removed this guest
  | "error"

export type UseGuestStudioReturn = {
  status: GuestStudioStatus
  error: string | null
  client: RTKClient | undefined
  compositorStream: MediaStream | null
  setCompositorStream: (stream: MediaStream | null) => void
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
  leaveSession: () => Promise<void>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGuestStudio(guestId: Id<"studioGuests">): UseGuestStudioReturn {
  const [status, setStatus] = useState<GuestStudioStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<RTKClient | undefined>(undefined)
  const [compositorStream, setCompositorStream] = useState<MediaStream | null>(null)
  const [sources, setSources] = useState<StudioSource[]>([])
  const [onCanvasSlots, _setOnCanvasSlots] = useState<(StudioSource | null)[]>([])
  // activeLayoutId is derived from stageState — no separate useState needed
  const [cameras, setCameras] = useState<StudioDevice[]>([])
  const [microphones, setMicrophones] = useState<StudioDevice[]>([])

  const rtkClientRef = useRef<RTKClient | null>(null)
  const isActiveRef = useRef(false)
  const hasInitRef = useRef(false)
  const stageParticipantIdsRef = useRef<string[]>([])
  const activeLayoutRef = useRef<LayoutConfig>(STUDIO_LAYOUT_MAP[DEFAULT_LAYOUT_ID])
  const onCanvasSlotsRef = useRef<(StudioSource | null)[]>([])
  const sourcesRef = useRef<StudioSource[]>([])
  const videoElCacheRef = useRef<Map<string, VideoElEntry>>(new Map())
  const animFrameRef = useRef<number | null>(null)

  const guestRecord = useQuery(api.studio.getGuestStatus, { guestId })

  // Subscribe to the host's canvas state — drives the guest compositor
  const sessionId = guestRecord?.sessionId
  const stageState = useQuery(
    api.studio.getSessionStage,
    sessionId ? { sessionId } : "skip",
  )

  // Derive activeLayoutId from stageState so we don't call setState in an effect
  const activeLayoutId = stageState?.stageLayoutId ?? DEFAULT_LAYOUT_ID

  // ─── Slot helpers ───────────────────────────────────────────────────────────

  const setOnCanvasSlots = useCallback((slots: (StudioSource | null)[]) => {
    onCanvasSlotsRef.current = slots
    _setOnCanvasSlots(slots)
  }, [])

  // ─── Canvas derivation ──────────────────────────────────────────────────────
  // Rebuilds sources and canvas slots from current RTK state + Convex stage config.
  // Called on both RTK participant events and Convex stage state changes.

  const refreshCanvasFromStage = useCallback(() => {
    const c = rtkClientRef.current
    if (!isActiveRef.current || !c) return

    const cpids = stageParticipantIdsRef.current
    const layout = activeLayoutRef.current

    const allSources: StudioSource[] = [
      {
        id: `${c.self.id}:camera`,
        customParticipantId: c.self.customParticipantId,
        type: "camera",
        label: "You",
        track: c.self.videoTrack ?? null,
        videoEnabled: c.self.videoEnabled,
        audioEnabled: c.self.audioEnabled,
        isSelf: true,
      },
    ]

    if (c.self.screenShareEnabled) {
      allSources.push({
        id: `${c.self.id}:screen`,
        customParticipantId: c.self.customParticipantId,
        type: "screenshare",
        label: "Your Screen",
        track: c.self.screenShareTracks?.video ?? null,
        videoEnabled: true,
        audioEnabled: false,
        isSelf: true,
      })
    }

    // Skip self if RTK includes the local peer in the joined map
    c.participants.joined.forEach((p) => {
      if (p.customParticipantId === c.self.customParticipantId) return
      const cpid = p.customParticipantId ?? p.id
      allSources.push({
        id: `${p.id}:camera`,
        customParticipantId: cpid,
        type: "camera",
        label: p.name || "Guest",
        track: p.videoTrack ?? null,
        videoEnabled: p.videoEnabled,
        audioEnabled: p.audioEnabled,
        isSelf: false,
      })
      // Surface remote screen share as a separate source
      if (p.screenShareEnabled) {
        allSources.push({
          id: `${p.id}:screen`,
          customParticipantId: cpid,
          type: "screenshare",
          label: `${p.name || "Guest"} Screen`,
          track: p.screenShareTracks?.video ?? null,
          videoEnabled: true,
          audioEnabled: false,
          isSelf: false,
        })
      }
    })

    // Map stage slot order from Convex to actual source objects.
    // Stage entries are "customParticipantId:camera" or "customParticipantId:screen";
    // bare customParticipantId (legacy) falls back to camera.
    const slots: (StudioSource | null)[] = layout.slots.map((_, i) => {
      const entry = cpids[i]
      if (!entry) return null
      const colonIdx = entry.lastIndexOf(":")
      const baseCpid = colonIdx !== -1 ? entry.slice(0, colonIdx) : entry
      const typeHint = colonIdx !== -1 ? entry.slice(colonIdx + 1) : "camera"
      const sourceType: StudioSource["type"] = typeHint === "screen" ? "screenshare" : "camera"
      return allSources.find((s) => s.customParticipantId === baseCpid && s.type === sourceType) ?? null
    })

    // Keep slot references current (track changes, participant leaves)
    const refreshedSlots = slots.map((slot) => {
      if (!slot) return null
      return allSources.find((s) => s.id === slot.id) ?? null
    })

    const currentIds = new Set(allSources.map((s) => s.id))
    cleanupStaleVideoEls(videoElCacheRef.current, currentIds)

    sourcesRef.current = allSources
    setOnCanvasSlots(refreshedSlots)
    setSources(allSources)
  }, [setOnCanvasSlots])

  // ─── Canvas compositor loop ─────────────────────────────────────────────────
  // Identical to use-studio's compositor — reads from refs, never goes stale.

  const startCompositorLoop = useCallback(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext("2d")!
    let lastFrameTime = 0

    function draw(timestamp: number) {
      if (timestamp - lastFrameTime < 1000 / 30) {
        animFrameRef.current = requestAnimationFrame(draw)
        return
      }
      lastFrameTime = timestamp

      ctx.fillStyle = "#111111"
      ctx.fillRect(0, 0, 1280, 720)

      const layout = activeLayoutRef.current
      const slots = onCanvasSlotsRef.current

      layout.slots.forEach((slotDef, i) => {
        const source = slots[i]
        if (!source) return

        const x = Math.round(slotDef.x * 1280)
        const y = Math.round(slotDef.y * 720)
        const w = Math.round(slotDef.w * 1280)
        const h = Math.round(slotDef.h * 720)

        const videoEl = getOrCreateVideoEl(videoElCacheRef.current, source)
        if (videoEl && videoEl.readyState >= 2) {
          ctx.drawImage(videoEl, x, y, w, h)
        } else {
          ctx.fillStyle = "#27272a"
          ctx.fillRect(x, y, w, h)

          const initial = (source.label[0] ?? "?").toUpperCase()
          const avatarR = Math.round(Math.min(w, h) * 0.15)
          const cx = x + w / 2
          const cy = y + h / 2

          ctx.beginPath()
          ctx.arc(cx, cy - avatarR * 0.3, avatarR, 0, Math.PI * 2)
          ctx.fillStyle = "#3f3f46"
          ctx.fill()

          ctx.fillStyle = "#d4d4d8"
          ctx.font = `bold ${Math.round(avatarR)}px sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(initial, cx, cy - avatarR * 0.3)

          ctx.fillStyle = "#a1a1aa"
          ctx.font = `${Math.round(h * 0.045)}px sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(source.label, cx, y + h * 0.82)
        }
      })

      animFrameRef.current = requestAnimationFrame(draw)
    }

    animFrameRef.current = requestAnimationFrame((ts) => draw(ts))
    setCompositorStream(canvas.captureStream(30))
  }, [])

  const stopCompositorLoop = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setCompositorStream(null)
  }, [])

  // ─── Device enumeration ─────────────────────────────────────────────────────

  const refreshDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    setCameras(
      devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Camera", kind: d.kind })),
    )
    setMicrophones(
      devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone", kind: d.kind })),
    )
  }, [])

  // ─── Initialize RTK once the Convex subscription delivers the auth token ────

  useEffect(() => {
    if (hasInitRef.current) return
    if (guestRecord?.status !== "admitted" || !guestRecord.rtkAuthToken) return

    hasInitRef.current = true
    const { rtkAuthToken } = guestRecord

    void (async () => {
      try {
        setStatus("connecting")
        const rtkClient = await RTKClient.init({ authToken: rtkAuthToken })
        await rtkClient.join()

        rtkClientRef.current = rtkClient
        isActiveRef.current = true

        // Register RTK event handlers to keep canvas in sync
        /* eslint-disable @typescript-eslint/no-explicit-any */
        ;(rtkClient.self as any).on("videoUpdate", refreshCanvasFromStage)
        ;(rtkClient.self as any).on("audioUpdate", refreshCanvasFromStage)
        ;(rtkClient.self as any).on("screenShareUpdate", refreshCanvasFromStage)
        ;(rtkClient.participants.joined as any).on("participantJoined", refreshCanvasFromStage)
        ;(rtkClient.participants.joined as any).on("participantLeft", refreshCanvasFromStage)
        ;(rtkClient.participants.joined as any).on("videoUpdate", refreshCanvasFromStage)
        ;(rtkClient.participants.joined as any).on("audioUpdate", refreshCanvasFromStage)
        ;(rtkClient.participants.joined as any).on("screenShareUpdate", refreshCanvasFromStage)
        /* eslint-enable @typescript-eslint/no-explicit-any */

        // Enable camera then mic — user can adjust via controls if denied
        try {
          await rtkClient.self.enableVideo()
          await rtkClient.self.enableAudio()
        } catch {
          // permission denied; user can enable manually
        }

        await refreshDevices()
        startCompositorLoop()
        // Initial canvas derivation — stageState may already be available from Convex
        if (stageParticipantIdsRef.current.length > 0) {
          refreshCanvasFromStage()
        }

        setClient(rtkClient)
        setStatus("connected")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect to studio")
        setStatus("error")
        hasInitRef.current = false // allow retry
      }
    })()
  }, [guestRecord?.status, guestRecord?.rtkAuthToken, refreshDevices, startCompositorLoop, refreshCanvasFromStage])

  // ─── Mirror host's stage state whenever Convex pushes an update ─────────────
  // activeLayoutId is derived below; this effect only updates refs and triggers
  // a canvas refresh on the next animation frame (deferred to avoid synchronous
  // setState in effect body).

  useEffect(() => {
    if (!stageState) return
    stageParticipantIdsRef.current = stageState.stageParticipantIds
    const layoutId = stageState.stageLayoutId ?? DEFAULT_LAYOUT_ID
    activeLayoutRef.current = STUDIO_LAYOUT_MAP[layoutId] ?? STUDIO_LAYOUT_MAP[DEFAULT_LAYOUT_ID]
    if (isActiveRef.current && rtkClientRef.current) {
      requestAnimationFrame(() => refreshCanvasFromStage())
    }
  }, [stageState, refreshCanvasFromStage])

  // ─── Detect removal via Convex subscription ─────────────────────────────────

  useEffect(() => {
    if (guestRecord?.status !== "removed") return
    if (!isActiveRef.current) return
    isActiveRef.current = false
    stopCompositorLoop()
    void rtkClientRef.current?.leaveRoom().catch(() => {})
    rtkClientRef.current = null
    setClient(undefined)
    setStatus("removed")
  }, [guestRecord?.status, stopCompositorLoop])

  // ─── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (isActiveRef.current && rtkClientRef.current) {
        void rtkClientRef.current.leaveRoom().catch(() => {})
        isActiveRef.current = false
        rtkClientRef.current = null
      }
      stopCompositorLoop()
      videoElCacheRef.current.clear()
    }
  }, [stopCompositorLoop])

  // ─── Track controls ──────────────────────────────────────────────────────────

  const toggleVideo = useCallback(async () => {
    const c = rtkClientRef.current
    if (!isActiveRef.current || !c) return
    if (c.self.videoEnabled) await c.self.disableVideo()
    else await c.self.enableVideo()
  }, [])

  const toggleAudio = useCallback(async () => {
    const c = rtkClientRef.current
    if (!isActiveRef.current || !c) return
    if (c.self.audioEnabled) await c.self.disableAudio()
    else await c.self.enableAudio()
  }, [])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      const c = rtkClientRef.current
      if (!isActiveRef.current || !c) return
      const device = cameras.find((d) => d.deviceId === deviceId)
      if (device) await c.self.setDevice(device as MediaDeviceInfo)
    },
    [cameras],
  )

  const switchMicrophone = useCallback(
    async (deviceId: string) => {
      const c = rtkClientRef.current
      if (!isActiveRef.current || !c) return
      const device = microphones.find((d) => d.deviceId === deviceId)
      if (device) await c.self.setDevice(device as MediaDeviceInfo)
    },
    [microphones],
  )

  const toggleScreenShare = useCallback(async () => {
    const c = rtkClientRef.current
    if (!isActiveRef.current || !c) return
    try {
      if (c.self.screenShareEnabled) await c.self.disableScreenShare()
      else await c.self.enableScreenShare()
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return
      setError(err instanceof Error ? err.message : "Screen share failed")
    }
  }, [])

  const leaveSession = useCallback(async () => {
    if (!isActiveRef.current || !rtkClientRef.current) return
    isActiveRef.current = false
    stopCompositorLoop()
    await rtkClientRef.current.leaveRoom()
    rtkClientRef.current = null
    setClient(undefined)
  }, [stopCompositorLoop])

  return {
    status,
    error,
    client,
    compositorStream,
    setCompositorStream,
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
    leaveSession,
  }
}
