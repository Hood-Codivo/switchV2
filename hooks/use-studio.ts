"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import type RTKClient from "@cloudflare/realtimekit"
import { STUDIO_LAYOUT_MAP, DEFAULT_LAYOUT_ID } from "@/lib/studio-layouts"
import type { LayoutConfig } from "@/lib/studio-layouts"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Public types ─────────────────────────────────────────────────────────────

export type StudioStatus =
  | "idle"
  | "requesting-session"
  | "connecting"
  | "connected"
  | "error"

export type StudioDevice = {
  deviceId: string
  label: string
  kind: MediaDeviceKind
}

export type StudioSource = {
  id: string
  type: "camera" | "screenshare"
  label: string
  track: MediaStreamTrack | null
  videoEnabled: boolean
  audioEnabled: boolean
  isSelf: boolean
}

export type StudioGuest = {
  _id: Id<"studioGuests">
  displayName: string
  status: "waiting" | "admitted" | "rejected" | "removed"
  rtkAuthToken?: string
}

export type UseStudioReturn = {
  status: StudioStatus
  error: string | null
  client: RTKClient | undefined
  compositorStream: MediaStream | null
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
  startSession: () => Promise<void>
  endSession: () => Promise<void>
  guests: StudioGuest[]
  sessionId: Id<"studioSessions"> | null
  sessionLoaded: boolean   // true once getActiveSession has resolved (even if null)
  generateInviteLink: () => Promise<string>
  admitGuest: (guestId: Id<"studioGuests">) => Promise<void>
  rejectGuest: (guestId: Id<"studioGuests">) => void
  removeGuest: (guestId: Id<"studioGuests">) => void
}

// ─── Video element cache ───────────────────────────────────────────────────────
// One HTMLVideoElement per source, reused across rAF frames.

type VideoElEntry = { el: HTMLVideoElement; track: MediaStreamTrack }

function getOrCreateVideoEl(
  cache: Map<string, VideoElEntry>,
  source: StudioSource,
): HTMLVideoElement | null {
  if (!source.videoEnabled || !source.track) return null

  const entry = cache.get(source.id)

  if (entry) {
    // Update srcObject only when the track reference changes
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

function cleanupStaleVideoEls(
  cache: Map<string, VideoElEntry>,
  currentIds: Set<string>,
) {
  cache.forEach((entry, id) => {
    if (!currentIds.has(id)) {
      entry.el.srcObject = null
      cache.delete(id)
    }
  })
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStudio(): UseStudioReturn {
  const [status, setStatus] = useState<StudioStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [compositorStream, setCompositorStream] = useState<MediaStream | null>(null)
  const [cameras, setCameras] = useState<StudioDevice[]>([])
  const [microphones, setMicrophones] = useState<StudioDevice[]>([])
  const [sources, setSources] = useState<StudioSource[]>([])
  const [onCanvasSlots, _setOnCanvasSlots] = useState<(StudioSource | null)[]>([null, null])
  const [activeLayoutId, _setActiveLayoutId] = useState(DEFAULT_LAYOUT_ID)

  const [meeting, initMeeting] = useRealtimeKitClient()

  // Refs that the rAF compositor loop reads from — avoids stale closures.
  // rtkClientRef holds the initialized client for use in callbacks; `meeting`
  // from useRealtimeKitClient may not be re-rendered yet when event handlers fire.
  const rtkClientRef = useRef<RTKClient | null>(null)
  const onCanvasSlotsRef = useRef<(StudioSource | null)[]>([null, null])
  const activeLayoutRef = useRef<LayoutConfig>(STUDIO_LAYOUT_MAP[DEFAULT_LAYOUT_ID])
  const sourcesRef = useRef<StudioSource[]>([])
  const videoElCacheRef = useRef<Map<string, VideoElEntry>>(new Map())
  const animFrameRef = useRef<number | null>(null)
  const isActiveRef = useRef(false)
  const hasAutoConnectedRef = useRef(false)

  const createSession = useAction(api.studio.createStudioSession)
  const endSessionAction = useAction(api.studio.endStudioSession)
  const generateInviteTokenMutation = useMutation(api.studio.generateInviteToken)
  const admitGuestAction = useAction(api.studio.admitGuest)
  const rejectGuestMutation = useMutation(api.studio.rejectGuest)
  const removeGuestMutation = useMutation(api.studio.removeGuest)

  // Subscribes to the active session record — will be used to restore
  // compositor state and stream background when the page reloads mid-session.
  const activeSession = useQuery(api.studio.getActiveSession)

  // Subscribe to guests for the active session
  const rawGuests = useQuery(
    api.studio.listSessionGuests,
    activeSession?._id ? { sessionId: activeSession._id } : "skip",
  )
  const guests: StudioGuest[] = (rawGuests ?? []).filter(
    (g) => g.status === "waiting" || g.status === "admitted",
  )

  // ─── Slot helpers ─────────────────────────────────────────────────────────

  const setOnCanvasSlots = useCallback((slots: (StudioSource | null)[]) => {
    onCanvasSlotsRef.current = slots
    _setOnCanvasSlots(slots)
  }, [])

  // ─── Source management ────────────────────────────────────────────────────

  const refreshSources = useCallback(() => {
    const client = rtkClientRef.current
    if (!isActiveRef.current || !client) return

    const all: StudioSource[] = []

    // Self camera
    all.push({
      id: `${client.self.id}:camera`,
      type: "camera",
      label: "You",
      track: client.self.videoTrack ?? null,
      videoEnabled: client.self.videoEnabled,
      audioEnabled: client.self.audioEnabled,
      isSelf: true,
    })

    // Self screen share (only present when active)
    if (client.self.screenShareEnabled) {
      all.push({
        id: `${client.self.id}:screen`,
        type: "screenshare",
        label: "Your Screen",
        track: client.self.screenShareTracks?.video ?? null,
        videoEnabled: true,
        audioEnabled: false,
        isSelf: true,
      })
    }

    // Remote participants
    client.participants.joined.forEach((participant) => {
      all.push({
        id: `${participant.id}:camera`,
        type: "camera",
        label: participant.name || "Guest",
        track: participant.videoTrack ?? null,
        videoEnabled: participant.videoEnabled,
        audioEnabled: participant.audioEnabled,
        isSelf: false,
      })
    })

    // Clean up video elements for departed sources
    const currentIds = new Set(all.map((s) => s.id))
    cleanupStaleVideoEls(videoElCacheRef.current, currentIds)

    // Refresh slot references — null out departed, update track refs for present
    const refreshedSlots = onCanvasSlotsRef.current.map((slot) => {
      if (!slot) return null
      return all.find((s) => s.id === slot.id) ?? null
    })
    setOnCanvasSlots(refreshedSlots)

    sourcesRef.current = all
    setSources(all)
  }, [setOnCanvasSlots])

  // ─── Canvas compositor ────────────────────────────────────────────────────
  // Single rAF loop draws all on-canvas slots at their layout-defined positions.
  // Reads from refs so the closure never goes stale.

  const startCompositorLoop = useCallback(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext("2d")!
    let lastFrameTime = 0

    function draw(timestamp: number) {
      // Cap draw rate to 30fps to match captureStream(30) and halve CPU usage
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
          // Camera off — draw a name-plate placeholder so the slot isn't blank
          ctx.fillStyle = "#27272a" // zinc-800
          ctx.fillRect(x, y, w, h)

          const initial = (source.label[0] ?? "?").toUpperCase()
          const avatarR = Math.round(Math.min(w, h) * 0.15)
          const cx = x + w / 2
          const cy = y + h / 2

          // Avatar circle
          ctx.beginPath()
          ctx.arc(cx, cy - avatarR * 0.3, avatarR, 0, Math.PI * 2)
          ctx.fillStyle = "#3f3f46" // zinc-700
          ctx.fill()

          // Initial letter
          ctx.fillStyle = "#d4d4d8" // zinc-300
          ctx.font = `bold ${Math.round(avatarR)}px sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(initial, cx, cy - avatarR * 0.3)

          // Name label at bottom
          ctx.fillStyle = "#a1a1aa" // zinc-400
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

  // ─── Device enumeration ───────────────────────────────────────────────────

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

  // ─── Session lifecycle ────────────────────────────────────────────────────

  // ─── RTK connection ───────────────────────────────────────────────────────
  // Shared by startSession (new session) and auto-reconnect (existing session).

  const connectWithToken = useCallback(async (authToken: string) => {
    setStatus("connecting")
    const client = await initMeeting({ authToken })
    if (!client) throw new Error("Failed to initialize RTK client")
    await client.join()

    rtkClientRef.current = client
    isActiveRef.current = true

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(client.self as any).on("videoUpdate", refreshSources)
    ;(client.self as any).on("audioUpdate", refreshSources)
    ;(client.self as any).on("screenShareUpdate", refreshSources)
    ;(client.participants.joined as any).on("participantJoined", refreshSources)
    ;(client.participants.joined as any).on("participantLeft", refreshSources)
    ;(client.participants.joined as any).on("videoUpdate", refreshSources)
    ;(client.participants.joined as any).on("audioUpdate", refreshSources)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    refreshSources()
    const selfCamera = sourcesRef.current.find((s) => s.id === `${client.self.id}:camera`) ?? null
    const layout = STUDIO_LAYOUT_MAP[DEFAULT_LAYOUT_ID]
    const initialSlots: (StudioSource | null)[] = layout.slots.map((_, i) => (i === 0 ? selfCamera : null))
    setOnCanvasSlots(initialSlots)

    startCompositorLoop()
    await refreshDevices()
    setStatus("connected")
  }, [initMeeting, refreshSources, setOnCanvasSlots, startCompositorLoop, refreshDevices])

  const startSession = useCallback(async () => {
    try {
      setStatus("requesting-session")
      setError(null)
      const { authToken } = await createSession({})
      await connectWithToken(authToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start studio session")
      setStatus("error")
    }
  }, [createSession, connectWithToken])

  const endSession = useCallback(async () => {
    const client = rtkClientRef.current
    try {
      if (isActiveRef.current && client) {
        if (client.self.videoEnabled) await client.self.disableVideo()
        if (client.self.audioEnabled) await client.self.disableAudio()
        if (client.self.screenShareEnabled) await client.self.disableScreenShare()
        await client.leaveRoom()
      }
    } finally {
      isActiveRef.current = false
      rtkClientRef.current = null
      stopCompositorLoop()
      videoElCacheRef.current.clear()
      setOnCanvasSlots([null, null])
      setSources([])
      await endSessionAction({})
      hasAutoConnectedRef.current = false
      setStatus("idle")
    }
  }, [endSessionAction, stopCompositorLoop, setOnCanvasSlots])

  // Auto-reconnect when navigating to /studio/[sessionId] after a redirect from /studio.
  // The redirect unmounts StudioView (leaveRoom fires), then HostSessionView mounts fresh.
  // This effect re-joins using the session's stored creatorAuthToken from Convex.
  // Also handles direct navigation (bookmark/reload) to /studio/[sessionId].
  useEffect(() => {
    if (status !== "idle") return
    if (!activeSession?.creatorAuthToken) return
    if (hasAutoConnectedRef.current) return
    hasAutoConnectedRef.current = true
    void connectWithToken(activeSession.creatorAuthToken).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to reconnect to studio")
      setStatus("error")
    })
  }, [status, activeSession, connectWithToken])

  // ─── Track controls ───────────────────────────────────────────────────────

  const toggleVideo = useCallback(async () => {
    const client = rtkClientRef.current
    if (!isActiveRef.current || !client) return
    if (client.self.videoEnabled) {
      await client.self.disableVideo()
    } else {
      await client.self.enableVideo()
    }
  }, [])

  const toggleAudio = useCallback(async () => {
    const client = rtkClientRef.current
    if (!isActiveRef.current || !client) return
    if (client.self.audioEnabled) {
      await client.self.disableAudio()
    } else {
      await client.self.enableAudio()
    }
  }, [])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      const client = rtkClientRef.current
      if (!isActiveRef.current || !client) return
      const device = cameras.find((d) => d.deviceId === deviceId)
      if (device) await client.self.setDevice(device as MediaDeviceInfo)
    },
    [cameras],
  )

  const switchMicrophone = useCallback(
    async (deviceId: string) => {
      const client = rtkClientRef.current
      if (!isActiveRef.current || !client) return
      const device = microphones.find((d) => d.deviceId === deviceId)
      if (device) await client.self.setDevice(device as MediaDeviceInfo)
    },
    [microphones],
  )

  const toggleScreenShare = useCallback(async () => {
    const client = rtkClientRef.current
    if (!isActiveRef.current || !client) return
    try {
      if (client.self.screenShareEnabled) {
        await client.self.disableScreenShare()
      } else {
        await client.self.enableScreenShare()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return
      setError(err instanceof Error ? err.message : "Screen share failed")
    }
  }, [])

  // ─── Canvas slot management ───────────────────────────────────────────────

  const toggleSourceOnCanvas = useCallback(
    (sourceId: string) => {
      const slots = [...onCanvasSlotsRef.current]
      const existingIdx = slots.findIndex((s) => s?.id === sourceId)

      if (existingIdx !== -1) {
        slots[existingIdx] = null
      } else {
        const source = sourcesRef.current.find((s) => s.id === sourceId)
        if (!source) return
        const emptyIdx = slots.findIndex((s) => s === null)
        if (emptyIdx !== -1) {
          slots[emptyIdx] = source
        } else {
          slots[slots.length - 1] = source
        }
      }

      setOnCanvasSlots(slots)
    },
    [setOnCanvasSlots],
  )

  const switchLayout = useCallback(
    (layoutId: string) => {
      const layout = STUDIO_LAYOUT_MAP[layoutId]
      if (!layout) return
      activeLayoutRef.current = layout
      _setActiveLayoutId(layoutId)
      // Trim/pad slots to the new slot count
      const newSlots = layout.slots.map((_, i) => onCanvasSlotsRef.current[i] ?? null)
      setOnCanvasSlots(newSlots)
    },
    [setOnCanvasSlots],
  )

  // ─── Guest management ─────────────────────────────────────────────────────

  const generateInviteLink = useCallback(async (): Promise<string> => {
    const token = await generateInviteTokenMutation({})
    return `${window.location.origin}/studio/join/${token}`
  }, [generateInviteTokenMutation])

  const admitGuest = useCallback(
    async (guestId: Id<"studioGuests">) => {
      await admitGuestAction({ guestId })
    },
    [admitGuestAction],
  )

  const rejectGuest = useCallback(
    (guestId: Id<"studioGuests">) => {
      void rejectGuestMutation({ guestId })
    },
    [rejectGuestMutation],
  )

  const removeGuest = useCallback(
    (guestId: Id<"studioGuests">) => {
      void removeGuestMutation({ guestId })
    },
    [removeGuestMutation],
  )

  // ─── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (isActiveRef.current && rtkClientRef.current) {
        void rtkClientRef.current.leaveRoom().catch(() => {})
        isActiveRef.current = false
        rtkClientRef.current = null
      }
      stopCompositorLoop()
    }
  }, [stopCompositorLoop])

  return {
    status,
    error,
    client: status === "connected" ? meeting : undefined,
    compositorStream,
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
    startSession,
    endSession,
    guests,
    sessionId: activeSession?._id ?? null,
    sessionLoaded: activeSession !== undefined,
    generateInviteLink,
    admitGuest,
    rejectGuest,
    removeGuest,
  }
}
