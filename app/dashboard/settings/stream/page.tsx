"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { CATEGORIES, type StreamCategory } from "@/convex/schema"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Check } from "lucide-react"

export default function StreamSettingsPage() {
  const user = useQuery(api.users.getCurrentUser, {})
  const updateStreamPreferences = useMutation(api.users.updateStreamPreferences)

  const [category, setCategory] = useState<StreamCategory | null>(null)
  const [slowMode, setSlowMode] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derive displayed values: local state overrides user record
  const displayCategory = category ?? user?.defaultCategory ?? "Other"
  const displaySlowMode = slowMode ?? String(user?.defaultSlowModeInterval ?? 0)

  if (user === undefined) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  if (user === null) {
    return (
      <p className="text-sm text-muted-foreground">
        You must be signed in to access stream settings.
      </p>
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const interval = Number(displaySlowMode)
      if (isNaN(interval) || interval < 0) {
        throw new Error("Slow mode interval must be a non-negative number")
      }

      await updateStreamPreferences({
        defaultCategory: displayCategory as StreamCategory,
        defaultSlowModeInterval: interval,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stream Preferences</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure your default stream settings. These will be pre-filled when you go live.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="category">Default Category</Label>
          <Select
            value={displayCategory}
            onValueChange={(val) => setCategory(val as StreamCategory)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slowMode">Slow Mode Interval (seconds)</Label>
          <Input
            id="slowMode"
            type="number"
            min={0}
            value={displaySlowMode}
            onChange={(e) => setSlowMode(e.target.value)}
            placeholder="0"
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Set to 0 to disable slow mode. When enabled, viewers must wait this many seconds between
            chat messages.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving...
          </>
        ) : saved ? (
          <>
            <Check className="size-4" />
            Saved
          </>
        ) : (
          "Save Preferences"
        )}
      </Button>
    </div>
  )
}
