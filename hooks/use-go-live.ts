"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAction, useQuery } from "convex/react"
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

  const streamIdRef = useRef<Id<"streams"> | null>(null)
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Convex actions — go-live and end-stream handled entirely on the backend
  const goLiveAction = useAction(api.streams.goLive)
  const endLivestreamAction = useAction(api.streams.endLivestream)

  // Reactive viewer count from Convex
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const activeStream = useQuery(
    api.streams.getActive,
    currentUser?._id ? { userId: currentUser._id } : "skip",
  )
  const viewerCount = activeStream?.viewerCount ?? 0

  // ─── Health monitoring ──────────────────────────────────────────────────

  const startHealthMonitoring = useCallback(() => {
    if (!client) return
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
      setLiveState("starting")
      try {
        const { streamId } = await goLiveAction({ title, category })
        streamIdRef.current = streamId as Id<"streams">
        setLiveState("live")
        startHealthMonitoring()
      } catch (err) {
        setLiveState("idle")
        streamIdRef.current = null
        throw err
      }
    },
    [goLiveAction, startHealthMonitoring],
  )

  // ─── endStream ───────────────────────────────────────────────────────────

  const endStream = useCallback(async () => {
    const id = streamIdRef.current
    if (!id) return

    setLiveState("ending")
    stopHealthMonitoring()

    await endLivestreamAction({ streamId: id })

    setLiveState("idle")
    streamIdRef.current = null
  }, [endLivestreamAction, stopHealthMonitoring])

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
