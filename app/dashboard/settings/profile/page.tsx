"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Camera, Loader2, Check } from "lucide-react"

const profileSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  bio: z.string().max(280, "Bio must be 280 characters or less"),
})

type ProfileFormValues = z.infer<typeof profileSchema>

type FeedbackState = { type: "success" | "error"; message: string } | null

export default function ProfileSettingsPage() {
  const currentUser = useQuery(api.users.getCurrentUser, {})
  const updateProfile = useMutation(api.users.updateProfile)
  const generateUploadUrl = useMutation(api.users.generateUploadUrl)

  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    values: currentUser
      ? { displayName: currentUser.displayName ?? "", bio: currentUser.bio ?? "" }
      : undefined,
  })

  if (currentUser === undefined) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading profile...</span>
      </div>
    )
  }

  if (currentUser === null) {
    return (
      <p className="text-sm text-destructive">
        Could not load your profile. Please sign in again.
      </p>
    )
  }

  const avatarSrc = avatarPreview ?? currentUser.avatarUrl ?? null
  const initial = (currentUser.username ?? "?")[0]?.toUpperCase()

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setFeedback({ type: "error", message: "Please select an image file." })
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setFeedback({ type: "error", message: "Image must be under 5 MB." })
      return
    }

    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    setFeedback(null)
  }

  async function onSubmit(values: ProfileFormValues) {
    setFeedback(null)

    try {
      let avatarStorageId: string | undefined

      if (avatarFile) {
        setIsUploading(true)
        const uploadUrl = await generateUploadUrl()
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": avatarFile.type },
          body: avatarFile,
        })

        if (!response.ok) {
          throw new Error("Failed to upload avatar")
        }

        const { storageId } = (await response.json()) as { storageId: string }
        avatarStorageId = storageId
        setIsUploading(false)
      }

      await updateProfile({
        displayName: values.displayName,
        bio: values.bio,
        ...(avatarStorageId !== undefined
          ? { avatarStorageId: avatarStorageId as Id<"_storage"> }
          : {}),
      })

      setAvatarFile(null)
      setFeedback({ type: "success", message: "Profile updated." })
    } catch (err) {
      setIsUploading(false)
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      })
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage your display name, bio, and avatar.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 flex flex-col gap-6">
        {/* Avatar */}
        <div className="flex flex-col gap-2">
          <Label>Avatar</Label>
          <div className="flex items-center gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-full bg-zinc-800">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt="Avatar"
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-2xl font-semibold text-zinc-300">
                  {initial}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="avatar-upload"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
              >
                <Camera className="size-4" />
                Change avatar
              </label>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <p className="text-xs text-muted-foreground">
                JPG, PNG, or WebP. Max 5 MB.
              </p>
            </div>
          </div>
        </div>

        {/* Display Name */}
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

        {/* Bio */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            placeholder="Tell viewers about yourself..."
            rows={3}
            disabled={isSubmitting}
            {...register("bio")}
          />
          {errors.bio && (
            <p className="text-xs text-destructive">{errors.bio.message}</p>
          )}
          <p className="text-xs text-muted-foreground">280 characters max.</p>
        </div>

        {/* Feedback */}
        {feedback && (
          <p
            className={
              feedback.type === "success"
                ? "flex items-center gap-1.5 text-sm text-emerald-400"
                : "text-sm text-destructive"
            }
          >
            {feedback.type === "success" && <Check className="size-4" />}
            {feedback.message}
          </p>
        )}

        {/* Submit */}
        <Button type="submit" disabled={isSubmitting || isUploading} className="w-fit">
          {isSubmitting || isUploading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </form>
    </div>
  )
}
