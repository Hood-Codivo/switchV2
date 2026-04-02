"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useConvex, useQuery } from "convex/react"
import { usePrivy } from "@privy-io/react-auth"
import QRCode from "react-qr-code"
import { api } from "@/convex/_generated/api"
import { Search, ChevronDown, User, Video, Copy, Settings } from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"
import { Button } from "@/components/ui/button"
import { usePlatformWallet } from "@/hooks/use-platform-wallet"
import { truncateAddress } from "@/lib/solana/platform-wallet"
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
  const { details, usdcBalance, loading, error } = usePlatformWallet(currentUser?.walletAddress)
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
      <DropdownMenuContent align="end" className="w-72">
        <div className="px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
            Platform Wallet
          </p>
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-500">USDC balance</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">
                  {loading ? "Loading..." : `${usdcBalance ?? "0"} USDC`}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-zinc-500">Platform wallet</p>
                    <p className="truncate text-sm text-zinc-200">
                      {details ? truncateAddress(details.platformWalletPda, 6, 6) : "Unavailable"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!details}
                    onClick={async () => {
                      if (!details) return
                      await navigator.clipboard.writeText(details.platformWalletPda)
                    }}
                    className="rounded-md border border-zinc-800 p-2 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Copy platform wallet PDA"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-white p-2">
                {details ? (
                  <QRCode
                    value={details.platformWalletPda}
                    size={92}
                    bgColor="#ffffff"
                    fgColor="#09090b"
                  />
                ) : (
                  <div className="flex size-[92px] items-center justify-center text-center text-[11px] text-zinc-500">
                    Wallet unavailable
                  </div>
                )}
              </div>
            </div>
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/studio")}>
          <Video className="mr-2 size-4" />
          Stream Studio
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(`/${currentUser?.username}`)}>
          <User className="mr-2 size-4" />
          My Channel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/dashboard/settings/profile")}>
          <Settings className="mr-2 size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-400 focus:text-red-400"
          onClick={async () => {
            try {
              await logout()
            } finally {
              convex.clearAuth()
              router.replace("/sign-in")
            }
          }}
        >
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  const { ready, authenticated: isAuthenticated } = usePrivy()
  const isLoading = !ready
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
