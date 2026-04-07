"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { CATEGORIES } from "@/convex/schema"
import type { StreamCategory } from "@/convex/schema"
import type {
  StreamDurationOption,
  StreamOvertimeOption,
  StreamSessionPlan,
} from "@/hooks/use-go-live"
import { cn } from "@/lib/utils"

const STREAM_RATE_PER_HOUR_USD = 0.5
const SWTD_USD_PRICE = 0.00000536288
const DURATION_OPTIONS: StreamDurationOption[] = [30, 60, 120, 180, 300]
const OVERTIME_OPTIONS: StreamOvertimeOption[] = [0, 15, 30, 60]

type GoLiveModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (
    title: string,
    category: StreamCategory,
    sessionPlan: StreamSessionPlan,
  ) => Promise<void>
  isStarting: boolean
}

export function GoLiveModal({ open, onClose, onConfirm, isStarting }: GoLiveModalProps) {
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<StreamCategory | null>(null)
  const [plannedMinutes, setPlannedMinutes] = useState<StreamDurationOption>(60)
  const [allowExtraUsageSpending, setAllowExtraUsageSpending] = useState(false)
  const [overtimeMinutes, setOvertimeMinutes] = useState<StreamOvertimeOption>(30)

  if (!open) return null

  const canSubmit = title.trim().length > 0 && category !== null && !isStarting
  const prepaidCost = (plannedMinutes / 60) * STREAM_RATE_PER_HOUR_USD
  const overtimeCost = allowExtraUsageSpending
    ? (overtimeMinutes / 60) * STREAM_RATE_PER_HOUR_USD
    : 0
  const totalExposure = prepaidCost + overtimeCost
  const totalExposureSwtd = totalExposure / SWTD_USD_PRICE

  function formatUsd(value: number) {
    return `$${value.toFixed(2)}`
  }

  function formatToken(value: number) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    })
  }

  function formatMinutes(value: number) {
    if (value < 60) return `${value} min`
    if (value % 60 === 0) return `${value / 60} hr`
    return `${Math.floor(value / 60)} hr ${value % 60} min`
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && canSubmit) {
      void handleConfirm()
    }
  }

  async function handleConfirm() {
    if (!canSubmit || category === null) return
    await onConfirm(title.trim(), category, {
      plannedMinutes,
      allowExtraUsageSpending,
      overtimeMinutes: allowExtraUsageSpending ? overtimeMinutes : 0,
    })
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

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">
            Planned stream time
          </label>
          <div className="grid grid-cols-5 gap-2">
            {DURATION_OPTIONS.map((duration) => (
              <button
                key={duration}
                type="button"
                disabled={isStarting}
                onClick={() => setPlannedMinutes(duration)}
                className={cn(
                  "rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                  plannedMinutes === duration
                    ? "bg-red-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
                  isStarting && "cursor-not-allowed opacity-50",
                )}
              >
                {formatMinutes(duration)}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-300">
                Allow extra usage spending
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Keep streaming past your prepaid time using a capped overtime buffer.
              </p>
            </div>
            <button
              type="button"
              disabled={isStarting}
              onClick={() => setAllowExtraUsageSpending((current) => !current)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                allowExtraUsageSpending ? "bg-red-600" : "bg-zinc-700",
                isStarting && "cursor-not-allowed opacity-50",
              )}
              aria-pressed={allowExtraUsageSpending}
            >
              <span
                className={cn(
                  "inline-block size-4 rounded-full bg-white transition-transform",
                  allowExtraUsageSpending ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>

          {allowExtraUsageSpending && (
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Overtime cap
              </label>
              <div className="grid grid-cols-4 gap-2">
                {OVERTIME_OPTIONS.filter((option) => option > 0).map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={isStarting}
                    onClick={() => setOvertimeMinutes(option)}
                    className={cn(
                      "rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                      overtimeMinutes === option
                        ? "bg-red-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
                      isStarting && "cursor-not-allowed opacity-50",
                    )}
                  >
                    {formatMinutes(option)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Overtime is charged at the beginning of every 30-minute block while your stream is still live.
              </p>
            </div>
          )}
        </div>

        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Session Summary
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between text-zinc-300">
              <span>Prepaid time</span>
              <span>{formatMinutes(plannedMinutes)}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Prepaid cost</span>
              <span>{formatUsd(prepaidCost)}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Overtime</span>
              <span>
                {allowExtraUsageSpending
                  ? `${formatMinutes(overtimeMinutes)} max`
                  : "Off"}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Max overtime spend</span>
              <span>{allowExtraUsageSpending ? formatUsd(overtimeCost) : "$0.00"}</span>
            </div>
            <div className="mt-3 border-t border-zinc-800 pt-3 flex items-center justify-between font-medium text-white">
              <span>Total possible spend</span>
              <span>
                {formatUsd(totalExposure)}{" "}
                <span className="text-zinc-400">
                  ({formatToken(totalExposureSwtd)} $SWTD)
                </span>
              </span>
            </div>
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
  )
}
