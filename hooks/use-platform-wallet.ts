"use client";

import { useEffect, useState } from "react";
import {
  derivePlatformWallet,
  fetchUsdcAtaBalance,
  type PlatformWalletDetails,
} from "@/lib/solana/platform-wallet";

type PlatformWalletState = {
  details: PlatformWalletDetails | null;
  usdcBalance: string | null;
  loading: boolean;
  error: string | null;
};

export function usePlatformWallet(
  userWalletAddress?: string | null,
): PlatformWalletState {
  const [state, setState] = useState<PlatformWalletState>({
    details: null,
    usdcBalance: null,
    loading: Boolean(userWalletAddress),
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    if (!userWalletAddress) {
      setState({
        details: null,
        usdcBalance: null,
        loading: false,
        error: null,
      });
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null }));

    void (async () => {
      try {
        const details = await derivePlatformWallet(userWalletAddress);
        const balance = await fetchUsdcAtaBalance(
          details.platformWalletUsdcAta,
        );

        if (cancelled) return;

        setState({
          details,
          usdcBalance: balance.uiAmountString,
          loading: false,
          error: null,
        });
      } catch (error) {
        console.log(error);
        if (cancelled) return;

        setState({
          details: null,
          usdcBalance: null,
          loading: false,
          error: "Error generating wallet",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userWalletAddress]);

  return state;
}
