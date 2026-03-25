import { AuthGuard } from "@/components/auth-guard"
import { OnboardingGuard } from "@/components/onboarding-guard"
import { StudioView } from "@/components/studio/studio-view"

export default function StudioPage() {
  return (
    <AuthGuard>
      <OnboardingGuard>
        <StudioView />
      </OnboardingGuard>
    </AuthGuard>
  )
}
