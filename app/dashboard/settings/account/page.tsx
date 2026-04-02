"use client"

import { usePrivy } from "@privy-io/react-auth"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Label } from "@/components/ui/label"
import { Loader2, Mail, CheckCircle } from "lucide-react"

export default function AccountSettingsPage() {
  const { user: privyUser, ready } = usePrivy()
  const currentUser = useQuery(api.users.getCurrentUser, {})

  if (!ready || currentUser === undefined) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading account info...</span>
      </div>
    )
  }

  if (currentUser === null) {
    return (
      <p className="text-sm text-destructive">
        Could not load your account. Please sign in again.
      </p>
    )
  }

  const googleAccount = privyUser?.linkedAccounts?.find(
    (account) => account.type === "google_oauth",
  )

  const email =
    googleAccount && "email" in googleAccount
      ? (googleAccount.email as string)
      : privyUser?.email?.address ?? null

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-foreground">Account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        View your linked Google account information.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {/* Username (read-only) */}
        <div className="flex flex-col gap-1.5">
          <Label>Username</Label>
          <p className="text-sm text-foreground">@{currentUser.username}</p>
        </div>

        {/* Google OAuth */}
        <div className="flex flex-col gap-1.5">
          <Label>Google Account</Label>
          <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            <Mail className="size-5 text-zinc-400" />
            <div className="min-w-0 flex-1">
              {email ? (
                <p className="truncate text-sm text-foreground">{email}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No email linked</p>
              )}
            </div>
            {googleAccount && (
              <div className="flex items-center gap-1 text-emerald-400">
                <CheckCircle className="size-4" />
                <span className="text-xs font-medium">Linked</span>
              </div>
            )}
          </div>
        </div>

        {/* Wallet address (read-only) */}
        <div className="flex flex-col gap-1.5">
          <Label>Wallet Address</Label>
          <p className="break-all text-sm font-mono text-muted-foreground">
            {currentUser.walletAddress}
          </p>
        </div>
      </div>
    </div>
  )
}
