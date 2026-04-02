"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { usePlatformWallet } from "@/hooks/use-platform-wallet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowDownLeft, ArrowUpRight, Wallet, Coins } from "lucide-react"

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export default function EarningsPage() {
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const pointsBalance = useQuery(api.tips.getBalance, {})
  const tipHistory = useQuery(api.tips.listMyTipHistory, {})
  const withdrawMutation = useMutation(api.tips.withdraw)
  const { usdcBalance, loading: walletLoading } = usePlatformWallet(
    currentUser?.walletAddress,
  )

  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [withdrawStatus, setWithdrawStatus] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawStatus({ type: "error", message: "Enter a valid amount" })
      return
    }

    setWithdrawing(true)
    setWithdrawStatus(null)

    try {
      const result = await withdrawMutation({ amount })
      setWithdrawStatus({
        type: "success",
        message: `Withdrew ${amount} points. New balance: ${result.newBalance}`,
      })
      setWithdrawAmount("")
    } catch (err) {
      setWithdrawStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Withdrawal failed",
      })
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Earnings</h1>

      {/* Wallet Balance Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex items-center gap-2 text-zinc-400">
            <Coins className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Points Balance
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold text-zinc-100">
            {pointsBalance === undefined
              ? "Loading..."
              : pointsBalance === null
                ? "Sign in to view"
                : `${pointsBalance.toLocaleString()} pts`}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex items-center gap-2 text-zinc-400">
            <Wallet className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              USDC Balance
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold text-zinc-100">
            {walletLoading
              ? "Loading..."
              : `${usdcBalance ?? "0"} USDC`}
          </p>
        </div>
      </div>

      {/* Withdraw Section */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Withdraw Points
        </h2>
        <div className="mt-3 flex gap-3">
          <Input
            type="number"
            min={1}
            placeholder="Amount to withdraw"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            className="max-w-[200px]"
          />
          <Button
            onClick={handleWithdraw}
            disabled={withdrawing || !withdrawAmount}
          >
            {withdrawing ? "Processing..." : "Withdraw"}
          </Button>
        </div>
        {withdrawStatus && (
          <p
            className={`mt-2 text-sm ${
              withdrawStatus.type === "success"
                ? "text-emerald-400"
                : "text-red-400"
            }`}
          >
            {withdrawStatus.message}
          </p>
        )}
      </div>

      {/* Transaction Log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Transaction History
        </h2>

        {tipHistory === undefined ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-zinc-800/50"
              />
            ))}
          </div>
        ) : tipHistory.length === 0 ? (
          <div className="mt-8 flex flex-col items-center justify-center py-8 text-center">
            <Coins className="size-10 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-400">
              No transactions yet
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Tips you send and receive will appear here.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {tipHistory.map((tx) => (
              <li
                key={tx._id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    tx.direction === "received"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-orange-500/10 text-orange-400"
                  }`}
                >
                  {tx.direction === "received" ? (
                    <ArrowDownLeft className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-zinc-200">
                      {tx.direction === "received"
                        ? `From ${tx.counterpartyUsername}`
                        : `To ${tx.counterpartyUsername}`}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatDate(tx.createdAt)}
                    </span>
                  </div>
                  {tx.message && (
                    <p className="mt-0.5 truncate text-xs text-zinc-400">
                      {tx.message}
                    </p>
                  )}
                </div>

                <span
                  className={`shrink-0 text-sm font-semibold ${
                    tx.direction === "received"
                      ? "text-emerald-400"
                      : "text-orange-400"
                  }`}
                >
                  {tx.direction === "received" ? "+" : "-"}
                  {tx.amount} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
