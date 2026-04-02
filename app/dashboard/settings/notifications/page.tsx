"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader2, Check } from "lucide-react"

export default function NotificationSettingsPage() {
  const user = useQuery(api.users.getCurrentUser, {})
  const updateNotificationPreferences = useMutation(api.users.updateNotificationPreferences)

  const [goLive, setGoLive] = useState<boolean | null>(null)
  const [tips, setTips] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derive displayed values: local state overrides user record (default true)
  const displayGoLive = goLive ?? user?.notifyGoLive ?? true
  const displayTips = tips ?? user?.notifyTips ?? true

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
        You must be signed in to access notification settings.
      </p>
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      await updateNotificationPreferences({
        notifyGoLive: displayGoLive,
        notifyTips: displayTips,
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
        <h1 className="text-2xl font-bold text-foreground">Notification Preferences</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose which notifications you want to receive.
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <Label>Go-live Alerts</Label>
            <p className="text-xs text-muted-foreground">
              Get notified when creators you follow go live.
            </p>
          </div>
          <Switch
            checked={displayGoLive}
            onCheckedChange={(val) => setGoLive(val)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <Label>Tip Notifications</Label>
            <p className="text-xs text-muted-foreground">
              Get notified when you receive a tip from a viewer.
            </p>
          </div>
          <Switch
            checked={displayTips}
            onCheckedChange={(val) => setTips(val)}
          />
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
