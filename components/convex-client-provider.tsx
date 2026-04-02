"use client"

import { useMemo } from "react"
import { PrivyProvider, usePrivy } from "@privy-io/react-auth"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana"
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit"

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

const solanaConnectors = toSolanaWalletConnectors()
const solanaRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"
const solanaSubscriptionsUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL ??
  solanaRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet"
const supportedSolanaRpc = {
  [solanaChain]: {
    rpc: createSolanaRpc(solanaRpcUrl as Parameters<typeof createSolanaRpc>[0]),
    rpcSubscriptions: createSolanaRpcSubscriptions(
      solanaSubscriptionsUrl as Parameters<typeof createSolanaRpcSubscriptions>[0],
    ),
    blockExplorerUrl:
      solanaChain === "solana:mainnet"
        ? "https://explorer.solana.com"
        : `https://explorer.solana.com?cluster=${solanaChain.replace("solana:", "")}`,
  },
}

/**
 * Bridges Privy's auth state to the shape Convex expects.
 *
 * Convex calls `fetchAccessToken` before every request to attach the JWT.
 * Privy's `getAccessToken()` returns the current access token and auto-refreshes
 * if it's nearing expiration.
 */
function usePrivyAuth() {
  const { ready, authenticated, getAccessToken } = usePrivy()

  return useMemo(
    () => ({
      isLoading: !ready,
      isAuthenticated: authenticated,
      fetchAccessToken: async () => {
        if (!authenticated) return null
        const token = await getAccessToken()
        if (process.env.NODE_ENV === "development") {
          console.log("[privy-auth] token fetched:", token ? `${token.slice(0, 20)}...` : "null")
        }
        return token
      },
    }),
    [ready, authenticated, getAccessToken],
  )
}

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
      config={{
        loginMethods: ["google"],
        appearance: { theme: "dark" },
        solana: {
          rpcs: supportedSolanaRpc as never,
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        embeddedWallets: {
          solana: { createOnLogin: "all-users" },
        },
      }}
    >
      <ConvexProviderWithAuth client={convex} useAuth={usePrivyAuth}>
        {children}
      </ConvexProviderWithAuth>
    </PrivyProvider>
  )
}
