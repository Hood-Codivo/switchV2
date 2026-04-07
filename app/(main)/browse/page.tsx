"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Syne } from "next/font/google"
import { useQuery } from "convex/react"
import { usePrivy } from "@privy-io/react-auth"
import { api } from "@/convex/_generated/api"
import { CATEGORIES, type StreamCategory } from "@/convex/schema"
import { getThumbnailUrl } from "@/lib/stream-thumbnail"
import { cn } from "@/lib/utils"
import { Search, Radio, Eye, ChevronRight, X, Clock, Play } from "lucide-react"

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
})

function formatViewers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

function formatDuration(startedAt: number | undefined): string {
  if (!startedAt) return ""
  const totalMins = Math.floor((Date.now() - startedAt) / 60000)
  if (totalMins < 1) return "Just started"
  if (totalMins < 60) return `${totalMins}m`
  const hrs = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function BrowsePage() {
  const { authenticated } = usePrivy()
  const [selectedCategory, setSelectedCategory] = useState<StreamCategory | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const debouncedSearch = useDebounce(searchInput, 300)

  const streams = useQuery(api.streams.listLiveStreams, {
    category: selectedCategory,
    searchQuery: debouncedSearch,
  })
  const recentStreams = useQuery(api.streams.listRecentStreams, { limit: 8 })

  const isLoading = streams === undefined
  const hasStreams = streams !== undefined && streams.length > 0
  const featuredStream = hasStreams ? streams[0] : null
  const gridStreams = hasStreams ? streams.slice(1) : []
  const hasRecentStreams = recentStreams !== undefined && recentStreams.length > 0

  return (
    <div className={cn(syne.variable, "min-h-screen bg-[#07070a] text-zinc-100")}>
      <style>{`
        .grid-card {
          border: 1px solid rgba(63, 63, 70, 0.3);
          transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }
        .grid-card:hover {
          border-color: rgba(239, 68, 68, 0.35);
          box-shadow: 0 0 24px rgba(239, 68, 68, 0.06);
          transform: translateY(-2px);
        }
        .grid-card:focus-within {
          border-color: rgba(239, 68, 68, 0.5);
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15);
        }
        @keyframes countPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .viewer-pulse { animation: countPulse 2s ease-in-out infinite; }
        @keyframes glowShift {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.6; }
        }
        .featured-glow { animation: glowShift 5s ease-in-out infinite; }
        .category-active {
          background: linear-gradient(135deg, oklch(0.645 0.246 16.439), oklch(0.7 0.18 50));
          color: white;
        }
        .category-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .category-scroll::-webkit-scrollbar { display: none; }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .card-animate {
          opacity: 0;
          animation: cardIn 0.4s ease forwards;
        }
      `}</style>

      {/* ─── STICKY TOOLBAR + CATEGORIES ─── */}
      <div className="sticky top-14 z-40 border-b border-zinc-800/40 bg-[#07070a]/95 backdrop-blur-md">
        <div className="mx-auto max-w-[1400px] px-4 py-3">
          {/* Top row: title + search */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Radio className="size-4 text-red-500" />
              <h1 className={cn(syne.className, "text-lg font-bold tracking-tight")}>
                Browse
              </h1>
              {streams !== undefined && (
                <span className="rounded-full bg-zinc-800/80 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
                  {streams.length} live
                </span>
              )}
            </div>

            {/* Search */}
            <div className="relative w-full max-w-[280px]">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search streams…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 w-full rounded-full border border-zinc-800 bg-zinc-900/80 pl-9 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-700"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-500 transition-colors hover:text-zinc-300"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Category bar — horizontal scroll on mobile */}
          <div className="category-scroll -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={cn(
                "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200",
                selectedCategory === null
                  ? "category-active"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
              )}
            >
              All
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200",
                  selectedCategory === cat
                    ? "category-active"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── CONTENT ─── */}
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        {isLoading ? (
          <LoadingSkeleton />
        ) : hasStreams ? (
          <div className="space-y-6">
            {featuredStream && (
              <FeaturedCard
                stream={featuredStream.stream}
                creator={featuredStream.creator}
              />
            )}

            {gridStreams.length > 0 && (
              <div>
                <h2 className={cn(syne.className, "mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500")}>
                  More Live
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {gridStreams.map(({ stream, creator }, i) => (
                    <StreamCard
                      key={stream._id}
                      stream={stream}
                      creator={creator}
                      animationDelay={i * 60}
                      variant="live"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <QuietState
            searchQuery={debouncedSearch}
            recentStreams={recentStreams}
            hasRecentStreams={hasRecentStreams}
            authenticated={authenticated}
          />
        )}
      </div>
    </div>
  )
}

/* ─── FEATURED CARD ─── */

type StreamData = {
  _id: string
  title: string
  category: StreamCategory
  viewerCount: number
  peakViewerCount: number
  playbackUrl?: string
  startedAt?: number
}

type CreatorData = {
  username?: string
  displayName?: string
  avatarUrl?: string | null
  image?: string
} | null

function FeaturedCard({ stream, creator }: { stream: StreamData; creator: CreatorData }) {
  const thumbnailUrl = stream.playbackUrl ? getThumbnailUrl(stream.playbackUrl) : null
  const username = creator?.username ?? ""
  const avatarSrc = creator?.avatarUrl ?? creator?.image ?? null
  const initial = (username[0] ?? "?").toUpperCase()
  const duration = formatDuration(stream.startedAt)

  const card = (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-800/50 bg-zinc-900 transition-shadow duration-300 hover:shadow-[0_0_40px_rgba(239,68,68,0.06)]">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px]">
        {/* Thumbnail area */}
        <div className="relative aspect-video lg:aspect-auto lg:min-h-[320px]">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={stream.title}
              className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-zinc-800">
              <span className="text-sm text-zinc-600">No preview available</span>
            </div>
          )}

          {/* Ambient glow */}
          <div
            className="featured-glow pointer-events-none absolute -inset-8 -z-10 blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at center, oklch(0.645 0.246 16.439 / 0.18), transparent 70%)",
            }}
          />

          {/* Live badge */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-red-600/90 px-2.5 py-1 backdrop-blur-sm">
            <span className="inline-block size-2 rounded-full bg-white viewer-pulse" />
            <span className="text-xs font-bold text-white">LIVE</span>
          </div>

          {/* Viewer count */}
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 backdrop-blur-sm">
            <Eye className="size-3 text-zinc-300" />
            <span className="text-xs font-semibold tabular-nums text-zinc-200">
              {formatViewers(stream.viewerCount)}
            </span>
          </div>
        </div>

        {/* Info panel */}
        <div className="flex flex-col justify-between border-t border-zinc-800/40 p-6 lg:border-l lg:border-t-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                {stream.category}
              </span>
              {duration && (
                <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                  <Clock className="size-3" />
                  {duration}
                </span>
              )}
            </div>

            <h2 className={cn(syne.className, "mt-3 text-xl font-bold leading-snug tracking-tight lg:text-2xl")}>
              {stream.title}
            </h2>

            {/* Creator info */}
            <div className="mt-5 flex items-center gap-3">
              <div className="size-10 shrink-0 overflow-hidden rounded-full bg-zinc-800 ring-2 ring-zinc-700">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={username} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-sm font-bold text-zinc-400">
                    {initial}
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  @{username || "unknown"}
                </p>
                <p className="text-xs tabular-nums text-zinc-500">
                  {formatViewers(stream.viewerCount)} watching
                </p>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-6">
            <span className="inline-flex items-center gap-2 rounded-lg bg-[oklch(0.645_0.246_16.439)] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 group-hover:bg-[oklch(0.7_0.22_16)] group-hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]">
              <Play className="size-3.5 fill-current" />
              Watch Stream
            </span>
          </div>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div className="h-[2px] w-full origin-left scale-x-0 bg-gradient-to-r from-red-500 to-orange-500 transition-transform duration-500 group-hover:scale-x-100" />
    </div>
  )

  if (!username) return card

  return (
    <Link href={`/${username}`} className="block outline-none">
      {card}
    </Link>
  )
}

/* ─── STREAM CARD (reused for live + recent) ─── */

function StreamCard({
  stream,
  creator,
  animationDelay = 0,
  variant = "live",
}: {
  stream: StreamData
  creator: CreatorData
  animationDelay?: number
  variant?: "live" | "recent"
}) {
  const thumbnailUrl = stream.playbackUrl ? getThumbnailUrl(stream.playbackUrl) : null
  const username = creator?.username ?? ""
  const avatarSrc = creator?.avatarUrl ?? creator?.image ?? null
  const initial = (username[0] ?? "?").toUpperCase()
  const isLive = variant === "live"
  const duration = isLive ? formatDuration(stream.startedAt) : ""

  const card = (
    <div
      className="grid-card card-animate group flex flex-col overflow-hidden rounded-xl bg-zinc-900/80"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-zinc-800">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={stream.title}
            className={cn(
              "size-full object-cover transition-transform duration-300 group-hover:scale-105",
              !isLive && "opacity-50 group-hover:opacity-70",
            )}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <span className="text-[10px] text-zinc-700">No preview</span>
          </div>
        )}

        {/* Top-left badge */}
        {isLive ? (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-red-600/90 px-2 py-0.5 backdrop-blur-sm">
            <span className="inline-block size-1.5 rounded-full bg-white viewer-pulse" />
            <span className="text-[11px] font-bold text-white">LIVE</span>
          </div>
        ) : (
          <div className="absolute left-2 top-2 rounded-md bg-zinc-700/80 px-2 py-0.5 text-[11px] font-medium text-zinc-300 backdrop-blur-sm">
            Ended
          </div>
        )}

        {/* Bottom-right info */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {duration && (
            <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 backdrop-blur-sm">
              {duration}
            </span>
          )}
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-300 backdrop-blur-sm">
            {isLive
              ? `${formatViewers(stream.viewerCount)} viewers`
              : `${formatViewers(stream.peakViewerCount)} peak`}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2.5 p-3">
        <div className="size-7 shrink-0 overflow-hidden rounded-full bg-zinc-800">
          {avatarSrc ? (
            <img src={avatarSrc} alt={username} className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[10px] font-bold text-zinc-500">
              {initial}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[13px] font-semibold leading-tight", isLive ? "text-zinc-200" : "text-zinc-300")}>
            {stream.title}
          </p>
          <p className="mt-1 truncate text-[11px] text-zinc-500">
            @{username || "unknown"} · {stream.category}
          </p>
        </div>
      </div>
    </div>
  )

  if (!username) return card

  return (
    <Link href={`/${username}`} className="block outline-none">
      {card}
    </Link>
  )
}

/* ─── QUIET STATE ─── */

type RecentStream = {
  stream: StreamData
  creator: CreatorData
}

function QuietState({
  searchQuery,
  recentStreams,
  hasRecentStreams,
  authenticated,
}: {
  searchQuery: string
  recentStreams: RecentStream[] | undefined
  hasRecentStreams: boolean
  authenticated: boolean
}) {
  if (searchQuery) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <p className={cn(syne.className, "text-lg font-bold")}>
          No results for &ldquo;{searchQuery}&rdquo;
        </p>
        <p className="text-sm text-zinc-500">Try a different search or clear your filters.</p>
      </div>
    )
  }

  return (
    <div className="space-y-12">
      {/* CTA banner */}
      <div className="rounded-2xl border border-zinc-800/40 bg-gradient-to-b from-zinc-900/60 to-zinc-900/20 px-6 py-10 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-zinc-800/80">
          <Radio className="size-5 text-zinc-400" />
        </div>
        <h2 className={cn(syne.className, "text-xl font-bold")}>
          No one is live right now
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
          Streams start all the time. Check back soon or start your own.
        </p>
        <Link
          href={authenticated ? "/studio" : "/sign-in"}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[oklch(0.645_0.246_16.439)] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[oklch(0.7_0.22_16)]"
        >
          {authenticated ? "Go Live" : "Start Streaming"}
          <ChevronRight className="size-3.5" />
        </Link>
      </div>

      {/* Recent streams — reuses StreamCard */}
      {hasRecentStreams && recentStreams && (
        <div>
          <h3 className={cn(syne.className, "mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500")}>
            Recent Broadcasts
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentStreams.map(({ stream, creator }, i) => (
              <StreamCard
                key={stream._id}
                stream={stream}
                creator={creator}
                animationDelay={i * 60}
                variant="recent"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── LOADING SKELETON ─── */

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Featured skeleton */}
      <div className="overflow-hidden rounded-xl border border-zinc-800/50 bg-zinc-900">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px]">
          <div className="aspect-video animate-pulse bg-zinc-800 lg:aspect-auto lg:min-h-[320px]" />
          <div className="border-t border-zinc-800/40 p-6 lg:border-l lg:border-t-0">
            <div className="flex gap-2">
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-12 animate-pulse rounded bg-zinc-800" />
            </div>
            <div className="mt-4 h-7 w-3/4 animate-pulse rounded bg-zinc-800" />
            <div className="mt-2 h-7 w-1/2 animate-pulse rounded bg-zinc-800" />
            <div className="mt-6 flex items-center gap-3">
              <div className="size-10 animate-pulse rounded-full bg-zinc-800" />
              <div>
                <div className="h-3.5 w-24 animate-pulse rounded bg-zinc-800" />
                <div className="mt-1.5 h-3 w-16 animate-pulse rounded bg-zinc-800" />
              </div>
            </div>
            <div className="mt-6 h-10 w-36 animate-pulse rounded-lg bg-zinc-800" />
          </div>
        </div>
      </div>

      {/* Grid skeleton */}
      <div>
        <div className="mb-4 h-4 w-20 animate-pulse rounded bg-zinc-800" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-zinc-800/30 bg-zinc-900/80">
              <div className="aspect-video animate-pulse bg-zinc-800" />
              <div className="flex items-start gap-2.5 p-3">
                <div className="size-7 animate-pulse rounded-full bg-zinc-800" />
                <div className="flex-1">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-zinc-800" />
                  <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
