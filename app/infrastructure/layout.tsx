import Link from "next/link"
import { AuthGuard } from "@/components/auth-guard"
import { OnboardingGuard } from "@/components/onboarding-guard"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Cable, CreditCard, KeyRound, Radio, Terminal } from "lucide-react"

const navItems = [
  { href: "/infrastructure/dashboard", label: "Dashboard", icon: Cable },
  { href: "/infrastructure/dashboard#billing", label: "Billing", icon: CreditCard },
  { href: "/infrastructure/dashboard#api-keys", label: "API keys", icon: KeyRound },
  { href: "/infrastructure/dashboard#streams", label: "Streams", icon: Radio },
  { href: "/infrastructure/dashboard#integration", label: "Integration", icon: Terminal },
]

export default function InfrastructureLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <OnboardingGuard>
        <TooltipProvider>
          <div className="dark min-h-screen bg-background text-foreground">
            <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
              <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
                <Link
                  href="/infrastructure/dashboard"
                  className="flex min-h-10 items-center gap-2 rounded-md text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted">
                    <Cable className="size-4" aria-hidden="true" />
                  </span>
                  Switched Infrastructure
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Creator dashboard
                </Link>
              </div>
            </header>
            <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-[220px_1fr] md:px-6 lg:px-8">
              <aside className="hidden md:block">
                <nav className="sticky top-20 flex flex-col gap-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <item.icon className="size-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </aside>
              <main>{children}</main>
            </div>
          </div>
        </TooltipProvider>
      </OnboardingGuard>
    </AuthGuard>
  )
}
