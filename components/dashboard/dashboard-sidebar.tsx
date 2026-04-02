"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Video,
  Wallet,
  Users,
  Bell,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Radio,
  CreditCard,
  Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"

// ── Sidebar context ──────────────────────────────────────────────────

type SidebarContextValue = {
  collapsed: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
})

export function useSidebar() {
  return useContext(SidebarContext)
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const toggle = useCallback(() => setCollapsed((c) => !c), [])
  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

// ── Nav data ─────────────────────────────────────────────────────────

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Streams", href: "/dashboard/streams", icon: Video },
  { label: "Earnings", href: "/dashboard/earnings", icon: Wallet },
  { label: "Followers", href: "/dashboard/followers", icon: Users },
  { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
]

const settingsItems: NavItem[] = [
  { label: "Profile", href: "/dashboard/settings/profile", icon: User },
  { label: "Account", href: "/dashboard/settings/account", icon: CreditCard },
  { label: "Stream", href: "/dashboard/settings/stream", icon: Radio },
  { label: "Notifications", href: "/dashboard/settings/notifications", icon: Bell },
  { label: "Wallet", href: "/dashboard/settings/wallet", icon: Wallet },
]

// ── Nav link ─────────────────────────────────────────────────────────

function NavLink({
  item,
  pathname,
  collapsed,
  onClick,
}: {
  item: NavItem
  pathname: string
  collapsed?: boolean
  onClick?: () => void
}) {
  const isActive =
    item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(item.href)

  const link = (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && item.label}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

// ── Sidebar content (shared between desktop and mobile) ──────────────

function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const [settingsOpen, setSettingsOpen] = useState(
    pathname.startsWith("/dashboard/settings")
  )
  const isSettingsActive = pathname.startsWith("/dashboard/settings")

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-sidebar-border px-4",
          collapsed && "justify-center px-2"
        )}
      >
        <Link href="/" className="shrink-0">
          {collapsed ? (
            <Image
              src="/switched-logo-mobile.svg"
              alt="Switched"
              width={24}
              height={24}
              priority
            />
          ) : (
            <Image
              src="/switched-logo.svg"
              alt="Switched"
              width={110}
              height={22}
              priority
            />
          )}
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
            onClick={onNavigate}
          />
        ))}

        {/* Settings accordion */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href="/dashboard/settings/profile"
                  onClick={onNavigate}
                  className={cn(
                    "flex w-full items-center justify-center rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                    isSettingsActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Settings className="size-4 shrink-0" />
                </Link>
              }
            />
            <TooltipContent side="right" sideOffset={8}>
              Settings
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={() => setSettingsOpen((prev) => !prev)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isSettingsActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            )}
          >
            <span className="flex items-center gap-3">
              <Settings className="size-4 shrink-0" />
              Settings
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 transition-transform duration-200",
                settingsOpen && "rotate-180"
              )}
            />
          </button>
        )}

        {/* Settings sub-items */}
        {!collapsed && (
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-in-out",
              settingsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            )}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-1 pl-4 pt-1">
                {settingsItems.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    onClick={onNavigate}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Go Live card at bottom */}
      <div className={cn("shrink-0 border-t border-sidebar-border p-3", collapsed && "p-2")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href="/studio"
                  onClick={onNavigate}
                  className="group flex w-full flex-col items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 transition-all hover:border-red-500/40 hover:bg-red-500/15"
                >
                  <div className="flex size-10 items-center justify-center rounded-full bg-red-500 transition-transform group-hover:scale-110">
                    <Radio className="size-5 text-white" />
                  </div>
                </Link>
              }
            />
            <TooltipContent side="right" sideOffset={8}>
              Go Live
            </TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/studio"
            onClick={onNavigate}
            className="group flex w-full flex-col items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 transition-all hover:border-red-500/40 hover:bg-red-500/15"
          >
            <div className="flex size-10 items-center justify-center rounded-full bg-red-500 transition-transform group-hover:scale-110">
              <Radio className="size-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-zinc-100">Go Live</span>
            <span className="text-xs text-zinc-400">Start streaming</span>
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Desktop sidebar ──────────────────────────────────────────────────

export function DashboardSidebar() {
  const { collapsed, toggle } = useSidebar()

  return (
    <aside
      className={cn(
        "relative hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out md:block",
        collapsed ? "w-17" : "w-64"
      )}
    >
      <SidebarNav collapsed={collapsed} />

      {/* Collapse toggle on the border */}
      <button
        onClick={toggle}
        className="absolute -right-3 top-18 z-10 flex size-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/50 shadow-sm transition-colors hover:text-sidebar-foreground"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronLeft className="size-3.5" />
        )}
      </button>
    </aside>
  )
}

// ── Mobile sidebar trigger ───────────────────────────────────────────

export function MobileSidebarTrigger() {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="flex size-9 items-center justify-center rounded-lg border border-zinc-700 transition-colors hover:border-zinc-500 md:hidden">
        <Menu className="size-5 text-zinc-300" />
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-64 bg-sidebar p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
