"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { usePlatformWallet } from "@/hooks/use-platform-wallet"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Loader2, Copy, Check, Wallet, ExternalLink } from "lucide-react"
import { useState } from "react"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={handleCopy} title="Copy to clipboard">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

export default function WalletSettingsPage() {
  const user = useQuery(api.users.getCurrentUser, {})
  const { details, usdcBalance, loading: walletLoading, error: walletError } = usePlatformWallet(
    user?.walletAddress,
  )

  if (user === undefined) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  if (user === null) {
    return (
      <p className="text-sm text-muted-foreground">
        You must be signed in to access wallet settings.
      </p>
    )
  }

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Wallet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your wallet address and balance. This is read-only.
        </p>
      </div>

      <div className="space-y-6">
        {/* Connection Status */}
        <div className="flex items-center gap-3 rounded-lg border border-border p-4">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Wallet className="size-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Wallet Connected</p>
            <p className="text-xs text-muted-foreground">Managed by Privy</p>
          </div>
          <div className="size-2.5 rounded-full bg-green-500" title="Connected" />
        </div>

        {/* User Wallet Address */}
        <div className="space-y-2">
          <Label>Wallet Address</Label>
          <div className="flex items-center gap-2 rounded-md border border-input bg-input/30 px-3 py-2">
            <code className="flex-1 truncate text-sm text-foreground">
              {user.walletAddress}
            </code>
            <CopyButton text={user.walletAddress} />
            <a
              href={`https://solscan.io/account/${user.walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              title="View on Solscan"
            >
              <ExternalLink className="size-3.5 text-muted-foreground hover:text-foreground" />
            </a>
          </div>
        </div>

        {/* Platform Wallet (PDA) */}
        {walletLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Deriving platform wallet...</span>
          </div>
        )}

        {walletError && (
          <p className="text-sm text-destructive">{walletError}</p>
        )}

        {details && (
          <div className="space-y-2">
            <Label>Platform Wallet (PDA)</Label>
            <div className="flex items-center gap-2 rounded-md border border-input bg-input/30 px-3 py-2">
              <code className="flex-1 truncate text-sm text-foreground">
                {details.platformWalletPda}
              </code>
              <CopyButton text={details.platformWalletPda} />
              <a
                href={`https://solscan.io/account/${details.platformWalletPda}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Solscan"
              >
                <ExternalLink className="size-3.5 text-muted-foreground hover:text-foreground" />
              </a>
            </div>
          </div>
        )}

        {/* USDC Balance */}
        {usdcBalance !== null && (
          <div className="space-y-2">
            <Label>USDC Balance</Label>
            <div className="rounded-md border border-input bg-input/30 px-3 py-2">
              <span className="text-lg font-semibold text-foreground">{usdcBalance}</span>
              <span className="ml-1.5 text-sm text-muted-foreground">USDC</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
