"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { CATEGORIES, type StreamCategory } from "@/convex/schema"
import { getThumbnailUrl } from "@/lib/stream-thumbnail"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import Link from "next/link"

export function DiscoveryFeed() {
  const [selectedCategory, setSelectedCategory] = useState<StreamCategory | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const streams = useQuery(api.streams.listLiveStreams, {
    category: selectedCategory,
    searchQuery,
  })

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Search */}
        <div className="mb-6">
          <Input
            placeholder="Search streams or creators…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {/* Category filters */}
        <div className="mb-8 flex flex-wrap gap-2">
          <CategoryPill
            label="All"
            active={selectedCategory === null}
            onClick={() => setSelectedCategory(null)}
          />
          {CATEGORIES.map((cat) => (
            <CategoryPill
              key={cat}
              label={cat}
              active={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
            />
          ))}
        </div>

        {/* Stream grid */}
        {streams === undefined ? (
          <StreamGridSkeleton />
        ) : streams.length === 0 ? (
          <EmptyState searchQuery={searchQuery} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {streams.map(({ stream, creator }) => (
              <StreamCard
                key={stream._id}
                stream={stream}
                creator={creator}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
      )}
    >
      {label}
    </button>
  )
}

type StreamCardProps = {
  stream: {
    _id: string
    title: string
    category: StreamCategory
    viewerCount: number
    playbackUrl?: string
  }
  creator: {
    username?: string
    displayName?: string
    image?: string
    avatarUrl?: string | null
  } | null
}

function StreamCard({ stream, creator }: StreamCardProps) {
  const thumbnailUrl = stream.playbackUrl ? getThumbnailUrl(stream.playbackUrl) : null
  const creatorUsername = creator?.username ?? ""
  const avatarSrc = creator?.avatarUrl ?? creator?.image ?? null

  const content = (
    <>
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
        {/* Live badge + viewer count */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
            LIVE
          </span>
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {stream.viewerCount.toLocaleString()} viewers
          </span>
        </div>
        {/* Category tag */}
        <div className="absolute right-2 top-2">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {stream.category}
          </span>
        </div>
      </div>

      {/* Info row */}
      <div className="flex items-start gap-2">
        <div className="size-8 shrink-0 overflow-hidden rounded-full bg-muted">
          {avatarSrc ? (
            <img src={avatarSrc} alt={creatorUsername} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">
              {creatorUsername[0]?.toUpperCase() ?? "?"}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">{stream.title}</p>
          <p className="text-xs text-muted-foreground">@{creatorUsername}</p>
        </div>
      </div>
    </>
  )

  if (!creatorUsername) {
    return <div className="group flex flex-col gap-2">{content}</div>
  }

  return (
    <Link href={`/${creatorUsername}`} className="group flex flex-col gap-2">
      {content}
    </Link>
  )
}

function StreamGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="aspect-video animate-pulse rounded-lg bg-muted" />
          <div className="flex items-start gap-2">
            <div className="size-8 animate-pulse rounded-full bg-muted" />
            <div className="flex flex-1 flex-col gap-1">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="text-lg font-medium">
        {searchQuery ? `No streams matching "${searchQuery}"` : "No streams live right now"}
      </p>
      <p className="text-sm text-muted-foreground">
        {searchQuery ? "Try a different search term." : "Check back soon — streams start all the time."}
      </p>
    </div>
  )
}
