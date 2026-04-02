import { AuthGuard } from "@/components/auth-guard"
import { OnboardingGuard } from "@/components/onboarding-guard"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import {
  DashboardSidebar,
  SidebarProvider,
} from "@/components/dashboard/dashboard-sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <OnboardingGuard>
      <TooltipProvider>
        <SidebarProvider>
          <div className="dark flex h-screen bg-background text-foreground">
            {/* Sidebar: full height */}
            <DashboardSidebar />

            {/* Content column: header + page */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <DashboardHeader />
              <main className="flex-1 overflow-y-auto p-6">{children}</main>
            </div>
          </div>
        </SidebarProvider>
      </TooltipProvider>
      </OnboardingGuard>
    </AuthGuard>
  )
}
