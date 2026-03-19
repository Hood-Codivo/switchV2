"use client"

import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { useState } from "react"

type ChannelData = {
  user: Doc<"users">
  followerCount: number
}

type Props = {
  initialData: ChannelData
}

function FollowButton({
  creatorId,
  isOwnChannel,
}: {
  creatorId: Doc<"users">["_id"]
  isOwnChannel: boolean
}) {
  const { isAuthenticated } = useConvexAuth()
  const router = useRouter()
  const isFollowing = useQuery(api.follows.getFollowState, { creatorId })
  const followUser = useMutation(api.follows.followUser)
  const unfollowUser = useMutation(api.follows.unfollowUser)
  const [isPending, setIsPending] = useState(false)

  if (isOwnChannel) {
    return <Button disabled>Follow</Button>
  }

  if (!isAuthenticated) {
    return (
      <Button variant="outline" onClick={() => router.push("/sign-in")}>
        Sign in to follow
      </Button>
    )
  }

  if (isFollowing === undefined) {
    return <Button disabled>Follow</Button>
  }

  async function handleToggle() {
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
    <Button onClick={handleToggle} disabled={isPending} variant={isFollowing ? "outline" : "default"}>
      {isFollowing ? "Unfollow" : "Follow"}
    </Button>
  )
}

export function ChannelPageClient({ initialData }: Props) {
  // Real-time subscription — follower count updates live
  const liveData = useQuery(
    api.follows.getChannelPage,
    initialData.user.username ? { username: initialData.user.username } : "skip",
  )
  const currentUser = useQuery(api.users.getCurrentUser, {})

  const data = liveData ?? initialData
  const { user, followerCount } = data
  const isOwnChannel = currentUser?._id === user._id

  const avatarSrc = user.avatarUrl ?? user.image ?? null
  const initials = (user.displayName ?? user.username ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Profile header */}
        <div className="flex items-start gap-6">
          {/* Avatar */}
          <div className="size-20 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center text-xl font-semibold text-muted-foreground">
            {avatarSrc ? (
              <img src={avatarSrc} alt={user.displayName ?? ""} className="size-full object-cover" />
            ) : (
              initials
            )}
          </div>

          {/* Info */}
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">{user.displayName}</h1>
              {/* Live/offline indicator — streams not yet built */}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Offline
              </span>
            </div>
            <p className="text-sm text-muted-foreground">@{user.username}</p>
            <p className="text-sm text-muted-foreground">
              {followerCount.toLocaleString()} {followerCount === 1 ? "follower" : "followers"}
            </p>
            {user.bio && <p className="mt-2 text-sm">{user.bio}</p>}
          </div>

          {/* Follow button */}
          <FollowButton creatorId={user._id} isOwnChannel={isOwnChannel} />
        </div>
      </div>
    </div>
  )
}
