import { OnboardingGuard } from "@/components/onboarding-guard"
import { StudioView } from "@/components/studio/studio-view"

export default function StudioPage() {
  return (
    <OnboardingGuard>
      <StudioView />
    </OnboardingGuard>
  )
}
