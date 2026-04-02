"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Bell, Check, CheckCheck } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function NotificationSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-4">
      <Skeleton className="size-2 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const notifications = useQuery(api.notifications.list, {})
  const unreadCount = useQuery(api.notifications.getUnreadCount, {})
  const markRead = useMutation(api.notifications.markRead)
  const markAllRead = useMutation(api.notifications.markAllRead)

  const handleNotificationClick = (
    notificationId: Id<"notifications">,
    creatorUsername: string,
    isRead: boolean,
  ) => {
    if (!isRead) markRead({ notificationId })
    router.push(`/${creatorUsername}`)
  }

  const handleMarkRead = (
    e: React.MouseEvent,
    notificationId: Id<"notifications">,
  ) => {
    e.stopPropagation()
    markRead({ notificationId })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          {unreadCount !== undefined && unreadCount > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {unreadCount} unread
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!unreadCount || unreadCount === 0}
          onClick={() => markAllRead({})}
          className="gap-1.5"
        >
          <CheckCheck className="size-4" />
          Mark all as read
        </Button>
      </div>

      <div className="rounded-lg border border-zinc-800">
        {notifications === undefined ? (
          <>
            <NotificationSkeleton />
            <NotificationSkeleton />
            <NotificationSkeleton />
            <NotificationSkeleton />
            <NotificationSkeleton />
          </>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="mb-3 size-10 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-400">
              No notifications yet
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Follow creators to get notified when they go live.
            </p>
          </div>
        ) : (
          <div>
            {notifications.map((n) => (
              <button
                key={n._id}
                onClick={() =>
                  handleNotificationClick(n._id, n.creatorUsername, n.read)
                }
                className={cn(
                  "flex w-full items-center gap-3 border-b border-zinc-800 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-zinc-800/50",
                  !n.read && "border-l-2 border-l-red-500 bg-zinc-900/60",
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    n.read ? "bg-transparent" : "bg-red-500",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-200">
                    {n.creatorName} went live
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {n.streamTitle}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-600">
                  {formatRelativeTime(n.createdAt)}
                </span>
                {!n.read && (
                  <button
                    onClick={(e) => handleMarkRead(e, n._id)}
                    className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
                    title="Mark as read"
                  >
                    <Check className="size-4" />
                  </button>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
