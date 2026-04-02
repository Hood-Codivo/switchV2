"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { getThumbnailUrl } from "@/lib/stream-thumbnail"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Share2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import type { StreamCategory } from "@/convex/schema"
import type { Id } from "@/convex/_generated/dataModel"

type PastStream = {
  _id: Id<"streams">
  title: string
  category: StreamCategory
  viewerCount: number
  peakViewerCount: number
  tipTotal: number
  startedAt?: number
  endedAt?: number
  playbackUrl?: string
}

export default function StreamsPage() {
  const streams = useQuery(api.streams.listPastStreams, {})

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Past Streams</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Revisit your previous broadcasts.
      </p>

      <div className="mt-6">
        {streams === undefined ? (
          <StreamGridSkeleton />
        ) : streams.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {streams.map((stream) => (
              <PastStreamCard key={stream._id} stream={stream} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PastStreamCard({ stream }: { stream: PastStream }) {
  const [copied, setCopied] = useState(false)
  const thumbnailUrl = stream.playbackUrl
    ? getThumbnailUrl(stream.playbackUrl)
    : null

  const streamDate = stream.startedAt
    ? new Date(stream.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown date"

  function handleShare(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!stream.playbackUrl) return
    navigator.clipboard.writeText(stream.playbackUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const card = (
    <div className="group flex flex-col gap-2">
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={stream.title}
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <span className="text-xs text-muted-foreground">No preview</span>
          </div>
        )}
        {/* Category tag */}
        <div className="absolute right-2 top-2">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {stream.category}
          </span>
        </div>
        {/* Date badge */}
        <div className="absolute bottom-2 left-2">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {streamDate}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {stream.title}
          </p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 text-xs text-muted-foreground">
            <span>{stream.peakViewerCount.toLocaleString()} peak viewers</span>
            <span>{stream.tipTotal.toLocaleString()} tips</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={handleShare}
          title="Copy stream link"
        >
          <Share2
            className={cn(
              "size-4",
              copied ? "text-green-400" : "text-muted-foreground",
            )}
          />
        </Button>
      </div>
    </div>
  )

  if (stream.playbackUrl) {
    return (
      <a
        href={stream.playbackUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        {card}
      </a>
    )
  }

  return card
}

function StreamGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="aspect-video animate-pulse rounded-lg bg-muted" />
          <div className="flex flex-col gap-1">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-lg font-medium">No past streams yet</p>
      <p className="text-sm text-muted-foreground">
        Once you go live, your stream history will show up here.
      </p>
      <Button render={<Link href="/studio" />}>Go Live</Button>
    </div>
  )
}
