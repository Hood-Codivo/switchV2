"use client"

import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { Heart, MessageCircle, UsersRound, Smile } from "lucide-react"
import { useStreamViewer } from "@/hooks/use-stream-viewer"
import { StreamPlayer } from "@/components/stream/stream-player"
import Link from "next/link"
import Image from "next/image"

type ChannelData = {
  user: Doc<"users">
  followerCount: number
}

type Props = {
  initialData: ChannelData
  initialStream: Doc<"streams"> | null
}

// ─── Follow Button ──────────────────────────────────────────────────────────

function FollowButton({
  creatorId,
  isOwnChannel,
  followerCount,
}: {
  creatorId: Doc<"users">["_id"]
  isOwnChannel: boolean
  followerCount: number
}) {
  const { isAuthenticated } = useConvexAuth()
  const router = useRouter()
  const isFollowing = useQuery(api.follows.getFollowState, { creatorId })
  const followUser = useMutation(api.follows.followUser)
  const unfollowUser = useMutation(api.follows.unfollowUser)
  const [isPending, setIsPending] = useState(false)

  const countLabel = followerCount >= 1000
    ? `${(followerCount / 1000).toFixed(followerCount >= 10000 ? 0 : 1)}k`
    : followerCount.toLocaleString()

  async function handleToggle() {
    if (!isAuthenticated) {
      router.push("/sign-in")
      return
    }
    setIsPending(true)
    try {
      if (isFollowing) {
        await unfollowUser({ creatorId })
      } else {
        await followUser({ creatorId })
      }
    } finally {
      setIsPending(false)
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending || isOwnChannel}
      className="flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-50"
    >
      <Heart className={`size-4 ${isFollowing ? "fill-red-500 text-red-500" : ""}`} />
      {isFollowing ? "Following" : "Follow"}
      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
        {countLabel}
      </span>
    </button>
  )
}

// ─── Chat Placeholder ───────────────────────────────────────────────────────

function ChatPlaceholder() {
  return (
    <div className="flex h-full flex-col border border-border/65 bg-card">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button className="flex flex-1 items-center justify-center gap-2 border-b-2 border-red-500 py-3 text-sm font-medium text-zinc-100">
          <MessageCircle className="size-4" />
          Stream Chat
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 py-3 text-sm text-zinc-500 transition-colors hover:text-zinc-300">
          <UsersRound className="size-4" />
          Participants
        </button>
      </div>

      {/* Messages area */}
      <div className="flex flex-1 flex-col justify-end gap-2.5 overflow-y-auto p-4">
        <ChatBubble name="Viewer" color="text-emerald-400" message="Welcome to the stream!" />
        <ChatBubble name="Guest" color="text-sky-400" message="Lfg!!!" />
        <p className="py-8 text-center text-xs text-zinc-600">
          Chat will be available soon
        </p>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-3">
        <div className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2">
          <input
            type="text"
            placeholder="Send a message"
            disabled
            className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
          />
          <Smile className="size-4 text-zinc-600" />
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ name, color, message }: { name: string; color: string; message: string }) {
  return (
    <p className="text-sm">
      <span className={`font-semibold ${color}`}>{name}:</span>{" "}
      <span className="text-zinc-300">{message}</span>
    </p>
  )
}

// ─── Creator Info Bar ───────────────────────────────────────────────────────

function CreatorInfoBar({
  user,
  stream,
  followerCount,
  isOwnChannel,
}: {
  user: Doc<"users">
  stream: Doc<"streams"> | null
  followerCount: number
  isOwnChannel: boolean
}) {
  const avatarSrc = user.avatarUrl ?? user.image ?? null
  const initial = (user.displayName ?? user.username ?? "?")[0]?.toUpperCase()

  return (
    <div className="flex items-center gap-4 px-1 py-4">
      {/* Avatar */}
      <div className="size-12 shrink-0 overflow-hidden rounded-full bg-zinc-800">
        {avatarSrc ? (
          <Image src={avatarSrc} width={40} height={40} alt={user.displayName ?? ""} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-sm font-bold text-zinc-400">
            {initial}
          </span>
        )}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-100">{user.displayName ?? user.username}</p>
        {stream?.status === "live" && (
          <>
            <p className="truncate text-sm font-medium text-zinc-300">{stream.title}</p>
            <p className="text-xs text-zinc-500">{stream.category}</p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <FollowButton
          creatorId={user._id}
          isOwnChannel={isOwnChannel}
          followerCount={followerCount}
        />
        <Button
          size="sm"
          disabled
          className="rounded-full bg-red-500 px-5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
        >
          Send Tip
        </Button>
      </div>
    </div>
  )
}

// ─── Recommended Streams ────────────────────────────────────────────────────

function RecommendedStreams({ currentStreamId }: { currentStreamId?: string }) {
  const streams = useQuery(api.streams.listLiveStreams, {
    category: null,
    searchQuery: "",
  })

  const others = streams?.filter(({ stream }) => stream._id !== currentStreamId) ?? []
  if (others.length === 0) return null

  return (
    <div className="mt-6 border-t border-zinc-800 pt-6">
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
          LIVE
        </span>
        <h2 className="text-sm font-semibold text-zinc-200">Recommended Streams</h2>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-2">
        {others.slice(0, 6).map(({ stream, creator }) => {
          const username = creator?.username ?? ""
          const avatarSrc = creator?.avatarUrl ?? creator?.image ?? null
          const initial = (creator?.displayName ?? username ?? "?")[0]?.toUpperCase()

          return (
            <Link
              key={stream._id}
              href={`/${username}`}
              className="group flex w-40 shrink-0 flex-col items-center gap-2"
            >
              <div className="size-16 overflow-hidden rounded-full border-2 border-red-500/50 bg-zinc-800 transition-transform group-hover:scale-105">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={username} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-lg font-bold text-zinc-400">
                    {initial}
                  </span>
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-200">{creator?.displayName ?? username}</p>
                <p className="line-clamp-1 text-xs text-zinc-500">{stream.title}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Offline State ──────────────────────────────────────────────────────────

function OfflinePlayer({ user }: { user: Doc<"users"> }) {
  const avatarSrc = user.avatarUrl ?? user.image ?? null
  const initial = (user.displayName ?? user.username ?? "?")[0]?.toUpperCase()

  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl bg-zinc-900">
      <div className="mb-3 size-20 overflow-hidden rounded-full bg-zinc-800">
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-2xl font-bold text-zinc-500">
            {initial}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-zinc-400">
        {user.displayName ?? user.username} is offline
      </p>
      <p className="mt-1 text-xs text-zinc-600">Check back later for live content</p>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function ChannelPageClient({ initialData, initialStream }: Props) {
  const liveData = useQuery(
    api.follows.getChannelPage,
    initialData.user.username ? { username: initialData.user.username } : "skip",
  )
  const currentUser = useQuery(api.users.getCurrentUser, {})

  const liveStream = useQuery(
    api.streams.getByUsername,
    initialData.user.username ? { username: initialData.user.username } : "skip",
  )
  const stream = liveStream !== undefined ? liveStream : initialStream

  useStreamViewer(stream?.status === "live" ? stream._id : undefined)

  const data = liveData ?? initialData
  const { user, followerCount } = data
  const isOwnChannel = currentUser?._id === user._id
  const isLive = stream?.status === "live" && !!stream.playbackUrl

  return (
    <div className="dark min-h-(calc(100vh-88px)) bg-zinc-950 text-foreground">
      <div className="mx-auto max-w-364 px-4 py-4">
        {/* Two-column layout: video + chat */}
        <div className="flex gap-4">
          {/* Left — Video + info */}
          <div className="min-w-0 flex-1">
            {isLive ? (
              <StreamPlayer
                hlsUrl={stream.playbackUrl!}
                title={stream.title}
                category={stream.category}
                viewerCount={stream.viewerCount}
              />
            ) : stream?.status === "starting" ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-zinc-900">
                <div className="flex flex-col items-center gap-3">
                  <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
                  <p className="text-sm text-zinc-400">Stream is starting…</p>
                </div>
              </div>
            ) : (
              <OfflinePlayer user={user} />
            )}

            {/* Creator info bar (below video) */}
            <CreatorInfoBar
              user={user}
              stream={stream}
              followerCount={followerCount}
              isOwnChannel={isOwnChannel}
            />

            {/* Recommended streams */}
            <RecommendedStreams currentStreamId={stream?._id} />
          </div>

          {/* Right — Chat sidebar */}
          <div className="hidden w-[340px] shrink-0 lg:block">
            <div className="sticky top-[72px] h-[calc(100vh-88px)]">
              <ChatPlaceholder />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
