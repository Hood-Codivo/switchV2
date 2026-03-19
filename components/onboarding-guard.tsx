"use client"

import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { OnboardingDialog } from "@/components/onboarding-dialog"

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth()
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const googleProfile = useQuery(api.users.getGoogleProfile, {})

  const needsOnboarding = isAuthenticated && currentUser === null

  return (
    <>
      {children}
      <OnboardingDialog
        key={googleProfile?.name ?? "loading"}
        open={needsOnboarding}
        googleName={googleProfile?.name ?? undefined}
      />
    </>
  )
}
