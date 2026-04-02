"use client"

import { useEffect, useState } from "react"
import {
  fetchWalletUsdcBalance,
} from "@/lib/solana/platform-wallet"

type WalletUsdcBalanceState = {
  walletAddress: string | null
  ataAddress: string | null
  usdcBalance: string | null
  loading: boolean
  error: string | null
}

export function useWalletUsdcBalance(
  walletAddress?: string | null,
): WalletUsdcBalanceState {
  const [state, setState] = useState<WalletUsdcBalanceState>({
    walletAddress: walletAddress ?? null,
    ataAddress: null,
    usdcBalance: null,
    loading: Boolean(walletAddress),
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    if (!walletAddress) {
      setState({
        walletAddress: null,
        ataAddress: null,
        usdcBalance: null,
        loading: false,
        error: null,
      })
      return
    }

    setState((current) => ({ ...current, loading: true, error: null }))

    void (async () => {
      try {
        const balance = await fetchWalletUsdcBalance(walletAddress)

        if (cancelled) return

        setState({
          walletAddress,
          ataAddress: balance.ataAddress,
          usdcBalance: balance.uiAmountString,
          loading: false,
          error: null,
        })
      } catch (error) {
        console.log(error)
        if (cancelled) return

        setState({
          walletAddress,
          ataAddress: null,
          usdcBalance: null,
          loading: false,
          error: "Error loading balance",
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [walletAddress])

  return state
}
