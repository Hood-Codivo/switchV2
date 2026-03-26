"use client"

import { useQuery } from "convex/react"
import { usePrivy } from "@privy-io/react-auth"
import { api } from "@/convex/_generated/api"
import { OnboardingDialog } from "@/components/onboarding-dialog"

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { authenticated, user: privyUser } = usePrivy()
  const currentUser = useQuery(api.users.getCurrentUser, {})

  const needsOnboarding = authenticated && currentUser === null

  return (
    <>
      {children}
      <OnboardingDialog
        key={privyUser?.google?.name ?? "loading"}
        open={needsOnboarding}
        googleName={privyUser?.google?.name ?? undefined}
      />
    </>
  )
}
