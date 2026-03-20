"use client"

import { cn } from "@/lib/utils"

type StreamHealthIndicatorProps = {
  health: "good" | "degraded" | "poor" | "disconnected"
}

export function StreamHealthIndicator({ health }: StreamHealthIndicatorProps) {
  const dotColor = {
    good: "bg-green-500",
    degraded: "bg-yellow-400",
    poor: "bg-red-500",
    disconnected: "bg-red-500",
  }[health]

  const shouldPulse = health !== "good"

  const label = {
    good: "Good",
    degraded: "Degraded",
    poor: "Poor",
    disconnected: "Lost",
  }[health]

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn("size-2 rounded-full", dotColor, shouldPulse && "animate-pulse")}
      />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  )
}
