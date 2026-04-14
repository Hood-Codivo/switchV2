"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation, useAction } from "convex/react"
import { useSearchParams } from "next/navigation"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Check, Youtube, Unplug } from "lucide-react"

export default function StreamSettingsPage() {
  const user = useQuery(api.users.getCurrentUser, {})
  const updateStreamPreferences = useMutation(api.users.updateStreamPreferences)
  const connectedPlatforms = useQuery(api.connectedPlatforms.getConnectedPlatforms, {})
  const disconnectPlatform = useAction(api.connectedPlatformsActions.disconnectPlatform)

  const [category, setCategory] = useState<StreamCategory | null>(null)
  const [slowMode, setSlowMode] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [disconnectConfirm, setDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Read YouTube OAuth result from URL params
  const searchParams = useSearchParams()
  const youtubeResult = searchParams.get("youtube")
  const [youtubeMessage, setYoutubeMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  useEffect(() => {
    if (youtubeResult === "connected") {
      setYoutubeMessage({ type: "success", text: "YouTube channel connected successfully!" })
    } else if (youtubeResult === "error") {
      const reason = searchParams.get("reason") ?? "unknown"
      setYoutubeMessage({ type: "error", text: `Failed to connect YouTube: ${reason}` })
    }
  }, [youtubeResult, searchParams])

  // Derive displayed values: local state overrides user record
  const displayCategory = category ?? user?.defaultCategory ?? "Other"
  const displaySlowMode = slowMode ?? String(user?.defaultSlowModeInterval ?? 0)

  const youtubeConnection = connectedPlatforms?.find((p) => p.platform === "youtube")

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

  async function handleDisconnectYouTube() {
    setDisconnecting(true)
    try {
      await disconnectPlatform({ platform: "youtube" })
      setDisconnectConfirm(false)
      setYoutubeMessage({ type: "success", text: "YouTube channel disconnected." })
    } catch (err) {
      setYoutubeMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to disconnect",
      })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stream Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage connected platforms and configure your default stream settings.
        </p>
      </div>

      {/* ── Connected Platforms ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label>Connected Platforms</Label>

        {youtubeMessage && (
          <p
            className={`text-sm ${youtubeMessage.type === "success" ? "text-green-400" : "text-red-400"}`}
          >
            {youtubeMessage.text}
          </p>
        )}

        <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <Youtube className="size-5 text-red-500" />
            {youtubeConnection ? (
              <div>
                <p className="text-sm font-medium text-foreground">
                  {youtubeConnection.channelTitle ?? "YouTube"}
                </p>
                <span className="text-xs text-green-400">Active</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">YouTube</p>
            )}
          </div>

          {youtubeConnection ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDisconnectConfirm(true)}
              className="text-zinc-400 hover:text-red-400"
            >
              <Unplug className="mr-1.5 size-3.5" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = "/api/auth/youtube"
              }}
            >
              Connect
            </Button>
          )}
        </div>
      </div>

      {/* ── Stream Preferences ──────────────────────────────────────────── */}
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

      {/* ── Disconnect Confirmation Dialog ──────────────────────────────── */}
      <Dialog open={disconnectConfirm} onOpenChange={setDisconnectConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect YouTube?</DialogTitle>
            <DialogDescription>
              This will revoke Switched&apos;s access to your YouTube channel. You can reconnect at any
              time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDisconnectConfirm(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDisconnectYouTube()}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
