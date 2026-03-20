"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { CATEGORIES } from "@/convex/schema"
import type { StreamCategory } from "@/convex/schema"
import { cn } from "@/lib/utils"

type GoLiveModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (title: string, category: StreamCategory) => Promise<void>
  isStarting: boolean
}

export function GoLiveModal({ open, onClose, onConfirm, isStarting }: GoLiveModalProps) {
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<StreamCategory | null>(null)

  if (!open) return null

  const canSubmit = title.trim().length > 0 && category !== null && !isStarting

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && canSubmit) {
      void handleConfirm()
    }
  }

  async function handleConfirm() {
    if (!canSubmit || category === null) return
    await onConfirm(title.trim(), category)
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
