"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Bell, Check } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function NotificationBell() {
  const router = useRouter()
  const unreadCount = useQuery(api.notifications.getUnreadCount, {})
  const notifications = useQuery(api.notifications.list, {})
  const markRead = useMutation(api.notifications.markRead)
  const markAllRead = useMutation(api.notifications.markAllRead)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative flex size-9 items-center justify-center rounded-full border border-zinc-700 transition-colors hover:border-zinc-500">
        <Bell className="size-4 text-zinc-300" />
        {!!unreadCount && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold text-zinc-100">Notifications</span>
          {!!unreadCount && unreadCount > 0 && (
            <button
              onClick={() => markAllRead({})}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <Check className="size-3" />
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications === undefined ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-600">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-600">No notifications yet</div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {notifications.slice(0, 20).map((n) => (
              <DropdownMenuItem
                key={n._id}
                onClick={() => {
                  if (!n.read) markRead({ notificationId: n._id })
                  router.push(`/${n.creatorUsername}`)
                }}
                className="flex flex-col items-start gap-0.5 px-3 py-2"
              >
                <div className="flex w-full items-center gap-2">
                  {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-red-500" />}
                  <span className="text-sm font-medium text-zinc-200">{n.creatorName} went live</span>
                </div>
                <span className="text-xs text-zinc-500">{n.streamTitle}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
