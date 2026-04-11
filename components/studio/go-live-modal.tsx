"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, Loader2, Youtube } from "lucide-react";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/schema";
import type { StreamCategory } from "@/convex/schema";
import type { StreamSessionPlan } from "@/hooks/use-go-live";
import { useWalletMintBalance } from "@/hooks/use-wallet-mint-balance";
import { SWITCHED_TOKEN_MINT } from "@/lib/solana/tokens";
import {
  CHARGE_BLOCK_MINUTES,
  getSwtdCoverage,
  getSwtdFromUsd,
  getUsdFromMinutes,
} from "@/lib/stream-billing";
import { cn } from "@/lib/utils";

type GoLiveModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    title: string,
    category: StreamCategory,
    sessionPlan: StreamSessionPlan,
    destinations: { youtube: boolean },
  ) => Promise<void>;
  isStarting: boolean;
};

export function GoLiveModal({
  open,
  onClose,
  onConfirm,
  isStarting,
}: GoLiveModalProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<StreamCategory | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [youtubeEnabled, setYoutubeEnabled] = useState(true);
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const connectedPlatforms = useQuery(api.connectedPlatforms.getConnectedPlatforms, {});

  const youtubeConnection = connectedPlatforms?.find(
    (p) => p.platform === "youtube" && p.status === "active",
  );
  const swtdBalance = useWalletMintBalance(
    currentUser?.walletAddress,
    SWITCHED_TOKEN_MINT,
  );

  if (!open) return null;

  const coverage = getSwtdCoverage(Number(swtdBalance.balance ?? "0"));
  const blockChargeUsd = getUsdFromMinutes(CHARGE_BLOCK_MINUTES);
  const blockChargeSwtd = getSwtdFromUsd(blockChargeUsd);
  const canSubmit =
    title.trim().length > 0 &&
    category !== null &&
    !isStarting &&
    !swtdBalance.loading &&
    coverage.chargeableMinutes >= CHARGE_BLOCK_MINUTES;

  function formatUsd(value: number) {
    return `$${value.toFixed(2)}`;
  }

  function formatToken(value: number) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }

  function formatMinutes(value: number) {
    if (value <= 0) return "0 min";
    if (value < 60) return `${value} min`;
    if (value % 60 === 0) return `${value / 60} hr`;
    return `${Math.floor(value / 60)} hr ${value % 60} min`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && canSubmit) {
      void handleConfirm();
    }
  }

  async function handleConfirm() {
    if (!canSubmit || category === null) return;
    await onConfirm(
      title.trim(),
      category,
      {
        plannedMinutes: 60,
        allowExtraUsageSpending: true,
        overtimeMinutes: 0,
      },
      { youtube: !!youtubeConnection && youtubeEnabled },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl bg-zinc-900 p-6 shadow-2xl ring-1 ring-white/5">
        <h2 className="mb-5 text-lg font-semibold text-white">Go Live</h2>

        {/* Stream title */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">
            Stream title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            onKeyDown={handleKeyDown}
            placeholder="Stream title…"
            maxLength={100}
            disabled={isStarting}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none ring-1 ring-zinc-700 transition focus:ring-zinc-500 disabled:opacity-50"
            autoFocus
          />
        </div>

        {/* Category picker */}
        <div className="mb-6">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">
            Category
          </label>
          <div className="grid grid-cols-4 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                disabled={isStarting}
                onClick={() => setCategory(cat)}
                className={cn(
                  "rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors",
                  category === cat
                    ? "bg-red-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
                  isStarting && "cursor-not-allowed opacity-50",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
          <div className="flex items-start gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-300">
                Streaming allowance approval
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                You approve your full available $SWTD balance. The platform then
                charges at the start of every{" "}
                {formatMinutes(CHARGE_BLOCK_MINUTES)} block while your stream is
                live.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/80">
          <button
            type="button"
            onClick={() => setSummaryOpen((open) => !open)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                Session Summary
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {swtdBalance.loading
                  ? "Loading balance…"
                  : `${formatMinutes(coverage.chargeableMinutes)} available`}
              </p>
            </div>
            <ChevronDown
              className={cn(
                "size-4 text-zinc-500 transition-transform",
                summaryOpen && "rotate-180",
              )}
            />
          </button>
          {summaryOpen && (
            <div className="border-t border-zinc-800 px-4 pb-4 pt-3">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Current $SWTD balance</span>
                  <span>
                    {swtdBalance.loading
                      ? "Loading…"
                      : `${formatToken(coverage.swtdBalance)} $SWTD`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Chargeable time</span>
                  <span>{formatMinutes(coverage.chargeableMinutes)}</span>
                </div>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Per-block charge</span>
                  <span>
                    {formatUsd(blockChargeUsd)}{" "}
                    <span className="text-zinc-500">
                      ({formatToken(blockChargeSwtd)} $SWTD)
                    </span>
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3 font-medium text-white">
                  <span>Approval limit</span>
                  <span>
                    {formatUsd(coverage.approvalUsd)}{" "}
                    <span className="text-zinc-400">
                      ({formatToken(coverage.swtdBalance)} $SWTD)
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
          {coverage.chargeableMinutes < CHARGE_BLOCK_MINUTES &&
            !swtdBalance.loading && (
              <p className="px-4 pb-4 text-xs text-amber-300">
                You need at least 30 minutes worth of $SWTD to start streaming.
              </p>
            )}
        </div>

        {/* Destinations */}
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Destinations
          </p>
          <div className="space-y-2">
            {/* Switched — always on */}
            <div className="flex items-center justify-between rounded-lg bg-zinc-800/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-red-500" />
                <span className="text-sm text-zinc-300">Switched</span>
              </div>
              <span className="text-xs text-zinc-500">Always on</span>
            </div>

            {/* YouTube — toggle if connected */}
            {youtubeConnection && (
              <div className="flex items-center justify-between rounded-lg bg-zinc-800/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Youtube className="size-4 text-red-500" />
                  <span className="text-sm text-zinc-300">
                    {youtubeConnection.channelTitle ?? "YouTube"}
                  </span>
                </div>
                <Switch
                  checked={youtubeEnabled}
                  onCheckedChange={setYoutubeEnabled}
                  disabled={isStarting}
                />
              </div>
            )}

            {/* No platforms connected */}
            {(!connectedPlatforms || connectedPlatforms.length === 0) && (
              <Link
                href="/dashboard/settings/stream"
                className="block text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Connect platforms in Settings →
              </Link>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isStarting}
            className="flex-1 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canSubmit}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStarting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Starting…
              </>
            ) : (
              "Go Live"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
