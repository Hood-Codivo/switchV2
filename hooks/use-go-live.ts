"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type RTKClient from "@cloudflare/realtimekit"
import type { Id } from "@/convex/_generated/dataModel"
import type { StreamCategory } from "@/convex/schema"

// ─── Public types ─────────────────────────────────────────────────────────────

export type GoLiveState = "idle" | "starting" | "live" | "ending"
export type StreamHealth = "good" | "degraded" | "poor" | "disconnected"

export type UseGoLiveReturn = {
  liveState: GoLiveState
  viewerCount: number
  health: StreamHealth | null
  goLive: (title: string, category: StreamCategory) => Promise<void>
  endStream: () => Promise<void>
}

// ─── Health derivation ────────────────────────────────────────────────────────

function deriveHealth(report: RTCStatsReport): StreamHealth {
  let packetsLost = 0
  let packetsSent = 0
  let hasOutboundRtp = false

  report.forEach((stat) => {
    if (stat.type === "outbound-rtp") {
      hasOutboundRtp = true
      // RTCOutboundRtpStreamStats fields
      const s = stat as RTCOutboundRtpStreamStats & {
        packetsLost?: number
        packetsSent?: number
      }
      if (typeof s.packetsSent === "number") packetsSent += s.packetsSent
    }
    if (stat.type === "remote-inbound-rtp") {
      const s = stat as { packetsLost?: number }
      if (typeof s.packetsLost === "number") packetsLost += s.packetsLost
    }
  })

  if (!hasOutboundRtp) return "disconnected"
  if (packetsSent === 0) return "disconnected"

  const lossRate = packetsLost / (packetsSent + packetsLost)
  if (lossRate < 0.02) return "good"
  if (lossRate <= 0.1) return "degraded"
  return "poor"
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGoLive(
  sessionId: Id<"studioSessions"> | null,
  client: RTKClient | undefined,
): UseGoLiveReturn {
  const [liveState, setLiveState] = useState<GoLiveState>("idle")
  const [health, setHealth] = useState<StreamHealth | null>(null)

  // Store streamId in a ref to avoid stale closures in endStream
  const streamIdRef = useRef<Id<"streams"> | null>(null)
  // Interval ref for health polling cleanup
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Convex mutations
  const createStream = useMutation(api.streams.create)
  const setStatus = useMutation(api.streams.setStatus)
  const setLive = useMutation(api.streams.setLive)

  // Get current user for getActive query arg
  const currentUser = useQuery(api.users.getCurrentUser, {})

  // Reactive viewer count from Convex — skipped until we have a userId
  const activeStream = useQuery(
    api.streams.getActive,
    currentUser?._id ? { userId: currentUser._id } : "skip",
  )
  const viewerCount = activeStream?.viewerCount ?? 0

  // ─── Health monitoring ──────────────────────────────────────────────────

  const startHealthMonitoring = useCallback(() => {
    if (!client) return

    // RTK client exposes getStats() at runtime but it isn't in the type — safe cast
    const clientWithStats = client as unknown as { getStats?: () => Promise<RTCStatsReport> }
    healthIntervalRef.current = setInterval(() => {
      void clientWithStats.getStats?.().then((report) => {
        setHealth(deriveHealth(report))
      }).catch(() => {
        setHealth("disconnected")
      })
    }, 5000)
  }, [client])

  const stopHealthMonitoring = useCallback(() => {
    if (healthIntervalRef.current !== null) {
      clearInterval(healthIntervalRef.current)
      healthIntervalRef.current = null
    }
    setHealth(null)
  }, [])

  // ─── goLive ──────────────────────────────────────────────────────────────

  const goLive = useCallback(
    async (title: string, category: StreamCategory) => {
      if (!client) throw new Error("RTK client not connected")

      setLiveState("starting")

      // 1. Create stream record in Convex (idle status)
      const id = await createStream({ title, category })
      streamIdRef.current = id

      // 2. Transition to starting
      await setStatus({ id, status: "starting" })

      try {
        // 3. Start RTK livestream — Cloudflare Realtime manages the HLS egress
        await client.livestream.start({ manualIngestion: false })

        // 4. Retrieve the playback URL from the livestream object after start()
        const playbackUrl = client.livestream.playbackUrl
        if (!playbackUrl) throw new Error("RTK livestream started but no playback URL returned")

        // 5. Store playback URL and mark as live in Convex
        await setLive({ id, playbackUrl })
      } catch (err) {
        // Roll back — mark the stream ended so the channel page doesn't show
        // a permanently-spinning "starting" placeholder.
        await setStatus({ id, status: "ended", endedAt: Date.now() })
        streamIdRef.current = null
        setLiveState("idle")
        throw err
      }

      // 6. Update local state and begin health polling
      setLiveState("live")
      startHealthMonitoring()
    },
    [client, createStream, setStatus, setLive, startHealthMonitoring],
  )

  // ─── endStream ───────────────────────────────────────────────────────────

  const endStream = useCallback(async () => {
    const id = streamIdRef.current
    if (!id) return

    setLiveState("ending")

    // Stop health polling first
    stopHealthMonitoring()

    // Stop RTK livestream
    if (client) {
      await client.livestream.stop()
    }

    // Mark ended in Convex
    await setStatus({ id, status: "ended", endedAt: Date.now() })

    // Reset local state
    setLiveState("idle")
    streamIdRef.current = null
  }, [client, setStatus, stopHealthMonitoring])

  // ─── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (healthIntervalRef.current !== null) {
        clearInterval(healthIntervalRef.current)
        healthIntervalRef.current = null
      }
    }
  }, [])

  return {
    liveState,
    viewerCount,
    health,
    goLive,
    endStream,
  }
}
