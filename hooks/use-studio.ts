"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import type RTKClient from "@cloudflare/realtimekit"

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

export type UseStudioReturn = {
  status: StudioStatus
  error: string | null
  client: RTKClient | undefined
  compositorStream: MediaStream | null
  cameras: StudioDevice[]
  microphones: StudioDevice[]
  toggleVideo: () => Promise<void>
  toggleAudio: () => Promise<void>
  switchCamera: (deviceId: string) => Promise<void>
  switchMicrophone: (deviceId: string) => Promise<void>
  shareScreen: () => Promise<void>
  startSession: () => Promise<void>
  endSession: () => Promise<void>
}

export function useStudio(): UseStudioReturn {
  const [status, setStatus] = useState<StudioStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [compositorStream, setCompositorStream] = useState<MediaStream | null>(null)
  const [cameras, setCameras] = useState<StudioDevice[]>([])
  const [microphones, setMicrophones] = useState<StudioDevice[]>([])

  const [meeting, initMeeting] = useRealtimeKitClient()
  const animFrameRef = useRef<number | null>(null)
  const isActiveRef = useRef(false)

  const createSession = useAction(api.studio.createStudioSession)
  const endSessionAction = useAction(api.studio.endStudioSession)

  // Subscribes to the active session record — will be used in Slice N to restore
  // compositor state and stream background when the page reloads mid-session.
  useQuery(api.studio.getActiveSession)

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

  // ─── Canvas compositor ────────────────────────────────────────────────────
  // Draws the active video track onto a 1280×720 canvas at 30fps.
  // Slice 5 will extend this to composite multiple participant tiles.

  const startCompositor = useCallback((videoTrack: MediaStreamTrack) => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
    }

    const canvas = document.createElement("canvas")
    canvas.width = 1280
    canvas.height = 720

    const videoEl = document.createElement("video")
    videoEl.srcObject = new MediaStream([videoTrack])
    videoEl.muted = true
    void videoEl.play()

    const ctx2d = canvas.getContext("2d")!

    function draw() {
      ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
      animFrameRef.current = requestAnimationFrame(draw)
    }
    animFrameRef.current = requestAnimationFrame(draw)

    setCompositorStream(canvas.captureStream(30))
  }, [])

  const stopCompositor = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setCompositorStream(null)
  }, [])

  // ─── Session lifecycle ────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    try {
      setStatus("requesting-session")
      setError(null)

      const { authToken } = await createSession({})

      setStatus("connecting")

      const client = await initMeeting({ authToken })
      if (!client) throw new Error("Failed to initialize RTK client")

      await client.join()

      // Keep compositor in sync with video track changes (e.g. device switch, remote mute)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(client.self as any).on("videoUpdate", () => {
        if (client.self.videoEnabled && client.self.videoTrack) {
          startCompositor(client.self.videoTrack)
        } else {
          stopCompositor()
        }
      })

      // Bootstrap compositor if the preset auto-enables video on join
      if (client.self.videoEnabled && client.self.videoTrack) {
        startCompositor(client.self.videoTrack)
      }

      isActiveRef.current = true
      await refreshDevices()
      setStatus("connected")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start studio session")
      setStatus("error")
    }
  }, [createSession, initMeeting, refreshDevices, startCompositor, stopCompositor])

  const endSession = useCallback(async () => {
    try {
      if (isActiveRef.current) {
        if (meeting.self.videoEnabled) await meeting.self.disableVideo()
        if (meeting.self.audioEnabled) await meeting.self.disableAudio()
        await meeting.leaveRoom()
      }
    } finally {
      isActiveRef.current = false
      stopCompositor()
      await endSessionAction({})
      setStatus("idle")
    }
  }, [meeting, endSessionAction, stopCompositor])

  // ─── Track controls ───────────────────────────────────────────────────────

  const toggleVideo = useCallback(async () => {
    if (!isActiveRef.current) return
    if (meeting.self.videoEnabled) {
      await meeting.self.disableVideo()
    } else {
      await meeting.self.enableVideo()
    }
  }, [meeting])

  const toggleAudio = useCallback(async () => {
    if (!isActiveRef.current) return
    if (meeting.self.audioEnabled) {
      await meeting.self.disableAudio()
    } else {
      await meeting.self.enableAudio()
    }
  }, [meeting])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!isActiveRef.current) return
      const device = cameras.find((d) => d.deviceId === deviceId)
      if (device) await meeting.self.setDevice(device as MediaDeviceInfo)
    },
    [meeting, cameras],
  )

  const switchMicrophone = useCallback(
    async (deviceId: string) => {
      if (!isActiveRef.current) return
      const device = microphones.find((d) => d.deviceId === deviceId)
      if (device) await meeting.self.setDevice(device as MediaDeviceInfo)
    },
    [meeting, microphones],
  )

  const shareScreen = useCallback(async () => {
    if (!isActiveRef.current) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = stream.getVideoTracks()[0]
      if (screenTrack) await meeting.self.enableVideo(screenTrack)
    } catch (err) {
      // User cancelled the picker — not an error worth surfacing
      if (err instanceof DOMException && err.name === "NotAllowedError") return
      setError(err instanceof Error ? err.message : "Screen share failed")
    }
  }, [meeting])

  // ─── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopCompositor()
    }
  }, [stopCompositor])

  return {
    status,
    error,
    client: status === "connected" ? meeting : undefined,
    compositorStream,
    cameras,
    microphones,
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,
    shareScreen,
    startSession,
    endSession,
  }
}
