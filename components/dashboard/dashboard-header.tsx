"use client"

import Image from "next/image"
import Link from "next/link"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { NotificationBell } from "@/components/notification-bell"
import { MobileSidebarTrigger } from "@/components/dashboard/dashboard-sidebar"

function UserAvatar() {
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const avatarSrc = currentUser?.avatarUrl ?? null
  const initial = (currentUser?.username ?? "?")[0]?.toUpperCase()

  return (
    <div className="size-8 shrink-0 overflow-hidden rounded-full bg-zinc-700">
      {avatarSrc ? (
        <Image
          src={avatarSrc}
          alt=""
          width={32}
          height={32}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-xs font-semibold text-zinc-300">
          {initial}
        </span>
      )}
    </div>
  )
}

export function DashboardHeader() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar px-4">
      {/* Mobile: hamburger + logo */}
      <div className="flex items-center gap-3 md:hidden">
        <MobileSidebarTrigger />
        <Link href="/" className="shrink-0">
          <Image
            src="/switched-logo-mobile.svg"
            alt="Switched"
            width={24}
            height={24}
            priority
          />
        </Link>
      </div>

      {/* Desktop: empty left side (logo is in sidebar) */}
      <div className="hidden md:block" />

      {/* Right actions */}
      <div className="flex items-center gap-3">
        <NotificationBell />
        <UserAvatar />
      </div>
    </header>
  )
}
