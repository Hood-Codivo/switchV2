"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "convex/react"
import { usePrivy } from "@privy-io/react-auth"
import type { User as PrivyUser } from "@privy-io/react-auth"
import { api } from "@/convex/_generated/api"
import { validateUsername } from "@/convex/lib/username"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

function getSolanaWalletAddress(privyUser: PrivyUser | null): string | null {
  if (!privyUser) return null

  const solanaWallets = privyUser.linkedAccounts?.filter(
    (account) => account.type === "wallet" && "chainType" in account && account.chainType === "solana",
  ) ?? []

  const embeddedWallet = solanaWallets.find(
    (account) =>
      "walletClientType" in account &&
      (account.walletClientType === "privy" || account.walletClientType === "privy-v2"),
  )

  if (embeddedWallet && "address" in embeddedWallet) return embeddedWallet.address

  const fallbackWallet = solanaWallets.find((account) => "address" in account)
  if (fallbackWallet && "address" in fallbackWallet) return fallbackWallet.address

  return privyUser.wallet?.address ?? null
}

const schema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  username: z.string().superRefine((val, ctx) => {
    const result = validateUsername(val)
    if (!result.valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error })
    }
  }),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  googleName?: string
}

export function OnboardingDialog({ open, googleName }: Props) {
  const completeOnboarding = useMutation(api.users.completeOnboarding)
  const { user: privyUser } = usePrivy()

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: googleName ?? "",
      username: "",
    },
  })

  async function onSubmit(values: FormValues) {
    try {
      const walletAddress = getSolanaWalletAddress(privyUser)

      if (!walletAddress) {
        setError("root", { message: "Wallet not ready yet. Please try again." })
        return
      }

      await completeOnboarding({
        username: values.username,
        displayName: values.displayName,
        walletAddress,
      })
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Something went wrong",
      })
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="dark sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Set up your profile</DialogTitle>
          <DialogDescription>
            Choose a username and display name to get started on Switched.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              placeholder="Your name"
              disabled={isSubmitting}
              {...register("displayName")}
            />
            {errors.displayName && (
              <p className="text-xs text-destructive">{errors.displayName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="your-username"
              disabled={isSubmitting}
              {...register("username")}
              onChange={(e) =>
                setValue("username", e.target.value.toLowerCase(), { shouldValidate: true })
              }
            />
            {errors.username ? (
              <p className="text-xs text-destructive">{errors.username.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, hyphens, and underscores only. 3–30 characters.
              </p>
            )}
          </div>

          {errors.root && (
            <p className="text-sm text-destructive">{errors.root.message}</p>
          )}

          <Button type="submit" disabled={isSubmitting} className="mt-2">
            {isSubmitting ? "Setting up…" : "Continue"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
