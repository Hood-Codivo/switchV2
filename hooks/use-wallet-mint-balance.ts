"use client"

import { useEffect, useState } from "react"
import { fetchWalletMintBalance } from "@/lib/solana/platform-wallet"

type WalletMintBalanceState = {
  walletAddress: string | null
  ataAddress: string | null
  mintAddress: string
  balance: string | null
  loading: boolean
  error: string | null
}

export function useWalletMintBalance(
  walletAddress: string | null | undefined,
  mintAddress: string,
): WalletMintBalanceState {
  const [state, setState] = useState<WalletMintBalanceState>({
    walletAddress: walletAddress ?? null,
    ataAddress: null,
    mintAddress,
    balance: null,
    loading: Boolean(walletAddress),
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    if (!walletAddress) {
      setState({
        walletAddress: null,
        ataAddress: null,
        mintAddress,
        balance: null,
        loading: false,
        error: null,
      })
      return
    }

    setState((current) => ({
      ...current,
      walletAddress,
      mintAddress,
      loading: true,
      error: null,
    }))

    void (async () => {
      try {
        const tokenBalance = await fetchWalletMintBalance(walletAddress, mintAddress)

        if (cancelled) return

        setState({
          walletAddress,
          ataAddress: tokenBalance.ataAddress,
          mintAddress,
          balance: tokenBalance.uiAmountString,
          loading: false,
          error: null,
        })
      } catch (error) {
        console.log(error)
        if (cancelled) return

        setState({
          walletAddress,
          ataAddress: null,
          mintAddress,
          balance: null,
          loading: false,
          error: "Error loading balance",
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [walletAddress, mintAddress])

  return state
}
