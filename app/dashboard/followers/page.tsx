"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { Loader2, UserMinus, Users } from "lucide-react"

type Tab = "followers" | "following"

function UserAvatar({
  displayName,
  avatarUrl,
}: {
  displayName: string | undefined
  avatarUrl: string | null | undefined
}) {
  const initial = (displayName ?? "?")[0]?.toUpperCase() ?? "?"

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName ?? "User"}
        className="size-10 rounded-full object-cover"
      />
    )
  }

  return (
    <div className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
      {initial}
    </div>
  )
}

function UserRow({
  user,
  actionLabel,
  onAction,
}: {
  user: {
    _id: Id<"users">
    username: string | undefined
    displayName: string | undefined
    avatarUrl: string | null | undefined
  }
  actionLabel: string
  onAction: (userId: Id<"users">) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <UserAvatar
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {user.displayName ?? "Unknown"}
          </p>
          {user.username && (
            <p className="truncate text-xs text-muted-foreground">
              @{user.username}
            </p>
          )}
        </div>
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => onAction(user._id)}
      >
        <UserMinus data-icon="inline-start" />
        {actionLabel}
      </Button>
    </div>
  )
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Users className="mb-3 size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {tab === "followers"
          ? "You don't have any followers yet."
          : "You aren't following anyone yet."}
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export default function FollowersPage() {
  const [activeTab, setActiveTab] = useState<Tab>("followers")

  const followers = useQuery(api.follows.listFollowers)
  const following = useQuery(api.follows.listFollowing)

  const removeFollower = useMutation(api.follows.removeFollower)
  const unfollowUser = useMutation(api.follows.unfollowUser)

  const followersCount = followers?.length
  const followingCount = following?.length

  const handleRemoveFollower = (userId: Id<"users">) => {
    removeFollower({ followerId: userId })
  }

  const handleUnfollow = (userId: Id<"users">) => {
    unfollowUser({ creatorId: userId })
  }

  const data = activeTab === "followers" ? followers : following
  const isLoading = data === undefined

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground">Followers</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your followers and the creators you follow.
      </p>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
        <button
          onClick={() => setActiveTab("followers")}
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "followers"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Followers{followersCount !== undefined ? ` (${followersCount})` : ""}
        </button>
        <button
          onClick={() => setActiveTab("following")}
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "following"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Following{followingCount !== undefined ? ` (${followingCount})` : ""}
        </button>
      </div>

      {/* Content */}
      <div className="mt-4 space-y-2">
        {isLoading ? (
          <LoadingState />
        ) : data.length === 0 ? (
          <EmptyState tab={activeTab} />
        ) : activeTab === "followers" ? (
          data.map((user) => (
            <UserRow
              key={user._id}
              user={user}
              actionLabel="Remove"
              onAction={handleRemoveFollower}
            />
          ))
        ) : (
          data.map((user) => (
            <UserRow
              key={user._id}
              user={user}
              actionLabel="Unfollow"
              onAction={handleUnfollow}
            />
          ))
        )}
      </div>
    </div>
  )
}
