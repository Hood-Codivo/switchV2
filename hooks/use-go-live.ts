"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana"
import { api } from "@/convex/_generated/api"
import type RTKClient from "@cloudflare/realtimekit"
import type { Id } from "@/convex/_generated/dataModel"
import type { StreamCategory } from "@/convex/schema"

const solanaRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet"

// ─── Public types ─────────────────────────────────────────────────────────────

export type GoLiveState = "idle" | "starting" | "live" | "ending"
export type StreamHealth = "good" | "degraded" | "poor" | "disconnected"
export type StreamDurationOption = 30 | 60 | 120 | 180 | 300
export type StreamOvertimeOption = 0 | 15 | 30 | 60

export type StreamSessionPlan = {
  plannedMinutes: StreamDurationOption
  allowExtraUsageSpending: boolean
  overtimeMinutes: StreamOvertimeOption
}

export type YoutubeSimulcastOptions = {
  title: string
  description: string
  privacy: "public" | "unlisted" | "private"
}

export type SimulcastOptions = {
  youtube?: YoutubeSimulcastOptions
}

export type UseGoLiveReturn = {
  liveState: GoLiveState
  viewerCount: number
  health: StreamHealth | null
  goLive: (
    title: string,
    category: StreamCategory,
    sessionPlan: StreamSessionPlan,
    simulcast?: SimulcastOptions,
  ) => Promise<void>
  endStream: () => Promise<void>
}

function decodeBase64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function encodeBytesToBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
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
  const preparePlatformWalletAction = useAction(api.serverPlatformWallet.prepareEnsurePlatformWallet)
  const preparePrepaidSwtdChargeAction = useAction(api.serverPlatformWallet.preparePrepaidSwtdCharge)
  const submitPrepaidSwtdChargeAction = useAction(api.serverPlatformWallet.submitPrepaidSwtdCharge)
  const submitPlatformWalletAction = useAction(api.serverPlatformWallet.submitEnsurePlatformWallet)
  const goLiveAction = useAction(api.streams.goLive)
  const endLivestreamAction = useAction(api.streams.endLivestream)
  const { wallets: solanaWallets } = useWallets()
  const { signTransaction } = useSignTransaction()

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
    async (title: string, category: StreamCategory, sessionPlan: StreamSessionPlan, simulcast?: SimulcastOptions) => {
      setLiveState("starting")
      try {
        const walletAddress = currentUser?.walletAddress
        const embeddedWallet = walletAddress
          ? solanaWallets.find((wallet) => wallet.address === walletAddress)
          : null

        if (!walletAddress || !embeddedWallet) {
          throw new Error("Wallet not ready yet. Please try again.")
        }

        const prepareResult = await preparePlatformWalletAction({})
        if (!prepareResult.exists && prepareResult.transactionBase64) {
          const signedTransaction = await signTransaction({
            wallet: embeddedWallet,
            chain: solanaChain,
            transaction: decodeBase64ToBytes(prepareResult.transactionBase64),
          })

          await submitPlatformWalletAction({
            signedTransactionBase64: encodeBytesToBase64(signedTransaction.signedTransaction),
          })
        }

        const prepaidChargeResult = await preparePrepaidSwtdChargeAction({ sessionPlan })
        if (prepaidChargeResult.transactionBase64) {
          const signedTransaction = await signTransaction({
            wallet: embeddedWallet,
            chain: solanaChain,
            transaction: decodeBase64ToBytes(prepaidChargeResult.transactionBase64),
          })

          await submitPrepaidSwtdChargeAction({
            signedTransactionBase64: encodeBytesToBase64(signedTransaction.signedTransaction),
          })
        }

        const { streamId } = await goLiveAction({ title, category, sessionPlan, simulcast })
        streamIdRef.current = streamId as Id<"streams">
        setLiveState("live")
        startHealthMonitoring()
      } catch (err) {
        setLiveState("idle")
        streamIdRef.current = null
        throw err
      }
    },
    [
      currentUser?.walletAddress,
      goLiveAction,
      preparePrepaidSwtdChargeAction,
      preparePlatformWalletAction,
      signTransaction,
      solanaWallets,
      startHealthMonitoring,
      submitPrepaidSwtdChargeAction,
      submitPlatformWalletAction,
    ],
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
