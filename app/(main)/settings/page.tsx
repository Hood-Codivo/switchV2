"use client"

import { AuthGuard } from "@/components/auth-guard"
import { useQuery, useMutation } from "convex/react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { api } from "@/convex/_generated/api"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { Doc } from "@/convex/_generated/dataModel"

const schema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  bio: z.string(),
})

type FormValues = z.infer<typeof schema>

function ProfileForm({ user }: { user: Doc<"users"> }) {
  const updateProfile = useMutation(api.users.updateProfile)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty, isSubmitSuccessful },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: user.displayName ?? "",
      bio: user.bio ?? "",
    },
  })

  async function onSubmit(values: FormValues) {
    try {
      await updateProfile({ displayName: values.displayName, bio: values.bio })
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Something went wrong",
      })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={user.username ?? ""}
          disabled
          className="opacity-60"
        />
        <p className="text-xs text-muted-foreground">Username cannot be changed.</p>
      </div>

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
        <Label htmlFor="bio">Bio</Label>
        <Input
          id="bio"
          placeholder="Tell viewers about yourself"
          disabled={isSubmitting}
          {...register("bio")}
        />
      </div>

      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}
      {isSubmitSuccessful && !isDirty && (
        <p className="text-sm text-green-500">Profile updated.</p>
      )}

      <Button type="submit" disabled={isSubmitting || !isDirty} className="self-start">
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  )
}

function SettingsContent() {
  const currentUser = useQuery(api.users.getCurrentUser, {})

  if (currentUser === undefined) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto w-full max-w-lg px-4 py-12">
        <h1 className="mb-6 text-xl font-semibold">Profile settings</h1>
        {currentUser ? (
          <ProfileForm user={currentUser} />
        ) : (
          <p className="text-muted-foreground text-sm">You are not signed in.</p>
        )}
      </main>
    </div>
  )
}
