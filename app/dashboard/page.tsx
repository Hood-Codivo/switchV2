import { OnboardingGuard } from "@/components/onboarding-guard"

export default function DashboardPage() {
  return (
    <OnboardingGuard>
      <div className="dark flex min-h-screen flex-col bg-background text-foreground">
        <main className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">Dashboard coming soon.</p>
        </main>
      </div>
    </OnboardingGuard>
  )
}
