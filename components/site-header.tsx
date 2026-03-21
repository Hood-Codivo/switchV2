"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Search, ChevronDown, User, Video } from "lucide-react"
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
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const avatarSrc = currentUser?.avatarUrl ?? currentUser?.image ?? null
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
        <DropdownMenuItem className="text-red-400 focus:text-red-400">
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-zinc-800/50 bg-zinc-950 px-4 backdrop-blur-md">
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
