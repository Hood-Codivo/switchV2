"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import RTKClient from "@cloudflare/realtimekit"

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
  videoEnabled: boolean
  audioEnabled: boolean
  localVideoTrack: MediaStreamTrack | null
  localAudioTrack: MediaStreamTrack | null
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
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [localVideoTrack, setLocalVideoTrack] = useState<MediaStreamTrack | null>(null)
  const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null)
  const [compositorStream, setCompositorStream] = useState<MediaStream | null>(null)
  const [cameras, setCameras] = useState<StudioDevice[]>([])
  const [microphones, setMicrophones] = useState<StudioDevice[]>([])

  const clientRef = useRef<RTKClient | null>(null)
  const animFrameRef = useRef<number | null>(null)

  const createSession = useAction(api.studio.createStudioSession)
  const endSessionAction = useAction(api.studio.endStudioSession)

  // Fetch active session — used to restore state on page reload
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

  // ─── Canvas compositor scaffold ───────────────────────────────────────────
  // Draws the active video track onto a 1280×720 canvas at 30fps.
  // The captureStream() output is the compositorStream that Slice 8 will
  // push to Cloudflare Stream via RTMPS. Slice 5 will extend this to
  // composite multiple participant tiles based on the chosen layout.

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

  // ─── Sync local state from client ─────────────────────────────────────────

  const syncTrackState = useCallback(
    (client: RTKClient) => {
      const vEnabled = client.self.videoEnabled
      const aEnabled = client.self.audioEnabled
      const vTrack = client.self.videoTrack ?? null
      const aTrack = client.self.audioTrack ?? null

      setVideoEnabled(vEnabled)
      setAudioEnabled(aEnabled)
      setLocalVideoTrack(vEnabled ? vTrack : null)
      setLocalAudioTrack(aEnabled ? aTrack : null)

      if (vEnabled && vTrack) {
        startCompositor(vTrack)
      } else {
        stopCompositor()
      }
    },
    [startCompositor, stopCompositor],
  )

  // ─── Session lifecycle ────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    try {
      setStatus("requesting-session")
      setError(null)

      const { authToken } = await createSession({})

      setStatus("connecting")

      const client = await RTKClient.init({ authToken })
      await client.join()

      clientRef.current = client
      syncTrackState(client)
      await refreshDevices()
      setStatus("connected")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start studio session")
      setStatus("error")
    }
  }, [createSession, refreshDevices, syncTrackState])

  const endSession = useCallback(async () => {
    const client = clientRef.current
    if (client) {
      await client.leaveRoom()
      clientRef.current = null
    }
    stopCompositor()
    await endSessionAction({})
    setLocalVideoTrack(null)
    setLocalAudioTrack(null)
    setVideoEnabled(false)
    setAudioEnabled(false)
    setStatus("idle")
  }, [endSessionAction, stopCompositor])

  // ─── Track controls ───────────────────────────────────────────────────────

  const toggleVideo = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    if (videoEnabled) {
      await client.self.disableVideo()
    } else {
      await client.self.enableVideo()
    }
    syncTrackState(client)
  }, [videoEnabled, syncTrackState])

  const toggleAudio = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    if (audioEnabled) {
      await client.self.disableAudio()
    } else {
      await client.self.enableAudio()
    }
    syncTrackState(client)
  }, [audioEnabled, syncTrackState])

  const switchCamera = useCallback(async (deviceId: string) => {
    const client = clientRef.current
    if (!client) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    const device = devices.find((d) => d.deviceId === deviceId && d.kind === "videoinput")
    if (device) {
      await client.self.setDevice(device)
      syncTrackState(client)
    }
  }, [syncTrackState])

  const switchMicrophone = useCallback(async (deviceId: string) => {
    const client = clientRef.current
    if (!client) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    const device = devices.find((d) => d.deviceId === deviceId && d.kind === "audioinput")
    if (device) {
      await client.self.setDevice(device)
      syncTrackState(client)
    }
  }, [syncTrackState])

  const shareScreen = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
    const screenTrack = stream.getVideoTracks()[0]
    if (screenTrack) {
      await client.self.enableVideo(screenTrack)
      syncTrackState(client)
    }
  }, [syncTrackState])

  // ─── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopCompositor()
    }
  }, [stopCompositor])

  return {
    status,
    error,
    videoEnabled,
    audioEnabled,
    localVideoTrack,
    localAudioTrack,
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
