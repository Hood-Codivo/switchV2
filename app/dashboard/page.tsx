"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { usePlatformWallet } from "@/hooks/use-platform-wallet"
import Link from "next/link"
import {
  Radio,
  Users,
  Wallet,
  Bell,
  TrendingUp,
  Eye,
  Coins,
  Video,
  UserPen,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"

function StatCard({
  icon: Icon,
  label,
  value,
  href,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  href?: string
  accent?: string
}) {
  const content = (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5 transition-colors hover:border-zinc-700">
      <div className="flex items-center gap-2 text-zinc-400">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-semibold", accent ?? "text-zinc-100")}>
        {value}
      </p>
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }
  return content
}

function EmptyStreamCard() {
  return (
    <div className="col-span-full rounded-xl border border-dashed border-zinc-700 p-8 text-center">
      <Video className="mx-auto size-10 text-zinc-600" />
      <p className="mt-3 text-sm font-medium text-zinc-300">No streams yet</p>
      <p className="mt-1 text-xs text-zinc-500">
        Go live to see your stream stats here.
      </p>
      <Link
        href="/studio"
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
      >
        <Radio className="size-4" />
        Go Live
      </Link>
    </div>
  )
}

function RecentStreamCard({
  stream,
}: {
  stream: {
    title: string
    viewerCount: number
    peakViewerCount: number
    tipTotal: number
    startedAt?: number
    endedAt?: number
  }
}) {
  const date = stream.startedAt
    ? new Date(stream.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown date"

  return (
    <div className="col-span-full rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Last Stream
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{stream.title}</p>
          <p className="text-xs text-zinc-500">{date}</p>
        </div>
        <Link
          href="/dashboard/streams"
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          View all
          <ExternalLink className="ml-1 inline size-3" />
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Eye className="size-3.5" />
            <span className="text-xs">Peak Viewers</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {stream.peakViewerCount.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <TrendingUp className="size-3.5" />
            <span className="text-xs">Viewers</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {stream.viewerCount.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Coins className="size-3.5" />
            <span className="text-xs">Tips</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {stream.tipTotal.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-800/50" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-zinc-800/50" />
    </div>
  )
}

export default function DashboardOverviewPage() {
  const overview = useQuery(api.dashboard.getDashboardOverview, {})
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const { usdcBalance, loading: walletLoading } = usePlatformWallet(
    currentUser?.walletAddress,
  )

  if (overview === undefined) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your dashboard at a glance.
        </p>
        <div className="mt-6">
          <OverviewSkeleton />
        </div>
      </div>
    )
  }

  if (overview === null) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground">Overview</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to view your dashboard.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your dashboard at a glance.
          </p>
        </div>
        {overview.isLive && (
          <span className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            You are live
          </span>
        )}
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Followers"
          value={overview.followerCount.toLocaleString()}
          href="/dashboard/followers"
        />
        <StatCard
          icon={Wallet}
          label="Balance"
          value={`${overview.earningsSummary.walletBalance.toLocaleString()} pts`}
          href="/dashboard/earnings"
        />
        <StatCard
          icon={Coins}
          label="USDC"
          value={walletLoading ? "..." : `${usdcBalance ?? "0"} USDC`}
          href="/dashboard/earnings"
        />
        <StatCard
          icon={Bell}
          label="Unread"
          value={overview.unreadNotificationCount}
          href="/dashboard/notifications"
          accent={overview.unreadNotificationCount > 0 ? "text-red-400" : undefined}
        />
      </div>

      {/* Recent stream or empty state */}
      <div className="mt-6 grid gap-4">
        {overview.recentStream ? (
          <RecentStreamCard stream={overview.recentStream} />
        ) : (
          <EmptyStreamCard />
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">
          Quick Actions
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
          >
            <Radio className="size-4 text-red-400" />
            Go Live
          </Link>
          <Link
            href="/dashboard/settings/profile"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
          >
            <UserPen className="size-4 text-zinc-400" />
            Edit Profile
          </Link>
          {currentUser?.username && (
            <Link
              href={`/${currentUser.username}`}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
            >
              <ExternalLink className="size-4 text-zinc-400" />
              View Channel
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
