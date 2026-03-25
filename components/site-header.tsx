"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useConvexAuth, useConvex, useMutation, useQuery } from "convex/react"
import { usePrivy } from "@privy-io/react-auth"
import { api } from "@/convex/_generated/api"
import { Search, ChevronDown, User, Video, Bell, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function HeaderSearch() {
  return (
    <div className="relative hidden w-full max-w-[380px] sm:flex">
      <input
        type="text"
        placeholder="Search"
        className="h-9 w-full rounded-l-full border border-zinc-700 bg-zinc-900 pl-4 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
      />
      <button className="flex h-9 items-center justify-center rounded-r-full border border-l-0 border-zinc-700 bg-red-500 px-3.5 text-white transition-colors hover:bg-red-600">
        <Search className="size-4" />
      </button>
    </div>
  )
}

function ProfileDropdown() {
  const router = useRouter()
  const { logout } = usePrivy()
  const convex = useConvex()
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const avatarSrc = currentUser?.avatarUrl ?? null
  const initial = (currentUser?.username ?? "?")[0]?.toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full border border-zinc-700 py-1 pl-1 pr-2.5 transition-colors hover:border-zinc-500">
        <div className="size-7 shrink-0 overflow-hidden rounded-full bg-zinc-700">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs font-semibold text-zinc-300">
              {initial}
            </span>
          )}
        </div>
        <span className="hidden text-sm font-medium text-zinc-200 md:inline">
          {currentUser?.username ?? ""}
        </span>
        <ChevronDown className="size-3.5 text-zinc-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => router.push("/studio")}>
          <Video className="mr-2 size-4" />
          Stream Studio
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(`/${currentUser?.username}`)}>
          <User className="mr-2 size-4" />
          My Channel
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-400 focus:text-red-400"
          onClick={async () => {
            await logout()
            convex.clearAuth()
            router.push("/sign-in")
          }}
        >
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NotificationBell() {
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

export function SiteHeader() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border/60 bg-background px-4 backdrop-blur-md">
      {/* Logo */}
      <Link href="/" className="shrink-0">
        <Image
          src="/switched-logo.svg"
          alt="Switched"
          width={110}
          height={22}
          className="hidden md:block"
          priority
        />
        <Image
          src="/switched-logo-mobile.svg"
          alt="Switched"
          width={24}
          height={24}
          className="block md:hidden"
          priority
        />
      </Link>

      {/* Search */}
      <HeaderSearch />

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {isLoading ? (
          <div className="size-7 animate-pulse rounded-full bg-zinc-800" />
        ) : isAuthenticated ? (
          <>
            <Button
              size="sm"
              onClick={() => router.push("/studio")}
              className="rounded-full bg-red-500 px-4 text-xs font-semibold text-white hover:bg-red-600"
            >
              Go Live
              <ChevronDown className="ml-1 size-3" />
            </Button>
            <NotificationBell />
            <ProfileDropdown />
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push("/sign-in")}
            className="rounded-full px-5 text-xs"
          >
            Login
          </Button>
        )}
      </div>
    </header>
  )
}
