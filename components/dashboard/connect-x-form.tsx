"use client"

import { useAction, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ConnectXForm() {
  const existing = useQuery(api.connectedPlatforms.getPlatformByType, { platform: "x" })
  const connect = useAction(api.connectedPlatformsActions.connectXDirectRtmp)
  const disconnect = useAction(api.connectedPlatformsActions.disconnectPlatform)
  const [rtmpUrl, setRtmpUrl] = useState("")
  const [streamKey, setStreamKey] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (existing === undefined) return null

  if (existing?.status === "active") {
    return (
      <div className="rounded-md border border-border/50 p-4">
        <div className="mb-2 text-sm font-medium">X connected</div>
        <div className="mb-3 text-xs text-muted-foreground">{existing.displayName ?? "X account"}</div>
        <Button variant="outline" size="sm" onClick={() => void disconnect({ platform: "x" })}>
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border/50 p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setError(null)
        try {
          await connect({ rtmpUrl: rtmpUrl.trim(), streamKey: streamKey.trim() })
          setRtmpUrl("")
          setStreamKey("")
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setSubmitting(false)
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="x-rtmp-url">X RTMP URL</Label>
        <Input
          id="x-rtmp-url"
          value={rtmpUrl}
          onChange={(e) => setRtmpUrl(e.target.value)}
          placeholder="rtmp://..."
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="x-stream-key">X stream key</Label>
        <Input
          id="x-stream-key"
          value={streamKey}
          onChange={(e) => setStreamKey(e.target.value)}
          type="password"
          required
        />
      </div>
      <div className="text-xs text-muted-foreground">
        Get these from X Media Studio (studio.x.com) → Live Producer → Advanced settings.
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <Button type="submit" disabled={submitting || !rtmpUrl.trim() || !streamKey.trim()}>
        {submitting ? "Connecting…" : "Connect X"}
      </Button>
    </form>
  )
}
