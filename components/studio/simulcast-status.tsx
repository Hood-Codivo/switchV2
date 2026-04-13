"use client"
import { useQuery, useAction } from "convex/react"
import { useEffect, useState } from "react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react"

export function SimulcastStatus({ streamId }: { streamId: Id<"streams"> }) {
  const broadcasts = useQuery(api.streamBroadcasts.listForStream, { streamId })
  const abandon = useAction(api.streamBroadcasts.abandonBroadcast)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(() => Date.now())

  // Legitimate useEffect: imperative timer for the degraded-seconds counter
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  if (!broadcasts || broadcasts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {broadcasts.map((b) => {
        if (dismissed.has(b._id)) return null
        if (b.status === "live") {
          return (
            <div key={b._id} className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>LIVE on {b.platform === "youtube" ? "YouTube" : "X"}</span>
            </div>
          )
        }
        if (b.status === "degraded") {
          const seconds = b.degradedSince ? Math.floor((now - b.degradedSince) / 1000) : 0
          return (
            <div key={b._id} className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-2 text-xs text-yellow-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{b.platform} reconnecting… ({seconds}s)</span>
              {seconds >= 60 && (
                <Button variant="outline" size="sm" className="ml-auto"
                  onClick={() => void abandon({ broadcastId: b._id })}>
                  Stop {b.platform} simulcast
                </Button>
              )}
            </div>
          )
        }
        if (b.status === "failed") {
          return (
            <div key={b._id} className="flex items-center gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-300">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{b.platform} simulcast failed: {b.errorMessage ?? "unknown error"}</span>
              <button className="ml-auto text-red-200 hover:text-red-100"
                onClick={() => setDismissed((s) => new Set(s).add(b._id))}
                aria-label="dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
