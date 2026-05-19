"use client"

import { FormEvent, use, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertCircle, Copy, ExternalLink, Radio, Square, Video } from "lucide-react"

export default function InfrastructureStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ streamId: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const streamId = use(params).streamId as Id<"infrastructureStreams">
  const hostToken = use(searchParams).token ?? ""
  const data = useQuery(api.infrastructure.getStreamByAccessToken, { token: hostToken })
  const updateStatus = useMutation(api.infrastructure.updateStreamStatusByHostToken)
  const [playbackUrl, setPlaybackUrl] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  async function goLive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("live")
    setError(null)
    setMessage(null)
    try {
      await updateStatus({
        streamId,
        hostToken,
        status: "live",
        playbackUrl: playbackUrl.trim() || undefined,
      })
      setMessage("Stream marked live.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start stream")
    } finally {
      setPending(null)
    }
  }

  async function endStream() {
    setPending("end")
    setError(null)
    setMessage(null)
    try {
      await updateStatus({ streamId, hostToken, status: "ended" })
      setMessage("Stream ended and usage tokens were deducted.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not end stream")
    } finally {
      setPending(null)
    }
  }

  async function copyEmbed() {
    if (!data) return
    await navigator.clipboard.writeText(`${window.location.origin}${data.stream.embedPath}`)
    setMessage("Embed URL copied.")
  }

  if (data === undefined) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="h-72 w-full max-w-4xl animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!data || data.role !== "host" || data.stream.id !== streamId) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            <h1 className="text-sm font-semibold">Invalid studio link</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask the platform admin to generate a new host link from Switched Infrastructure.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <main className="flex min-h-[560px] flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <p className="text-sm text-muted-foreground">{data.organization.name}</p>
              <h1 className="text-xl font-semibold">{data.stream.title}</h1>
            </div>
            <span className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              {data.stream.status}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="flex aspect-video w-full max-w-5xl flex-col items-center justify-center rounded-lg border border-border bg-background p-6 text-center">
              <Video className="size-12 text-muted-foreground" aria-hidden="true" />
              <p className="mt-4 text-lg font-semibold">Hosted infrastructure studio</p>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                This page controls the infrastructure stream record and embed state. Connect
                WebRTC publishing here when the partner studio UI is ready.
              </p>
            </div>
          </div>
        </main>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold">Controls</h2>
            <form onSubmit={goLive} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="playback-url" className="text-sm font-medium">
                  Playback URL
                </label>
                <Input
                  id="playback-url"
                  value={playbackUrl}
                  onChange={(event) => setPlaybackUrl(event.target.value)}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://example.com/live.m3u8"
                />
                <p className="text-xs text-muted-foreground">
                  Optional HLS URL to show in the viewer embed.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <Button type="submit" disabled={pending === "live"} aria-busy={pending === "live"}>
                  <Radio className="size-4" aria-hidden="true" />
                  {pending === "live" ? "Starting..." : "Go live"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending === "end"}
                  aria-busy={pending === "end"}
                  onClick={() => void endStream()}
                >
                  <Square className="size-4" aria-hidden="true" />
                  {pending === "end" ? "Ending..." : "End stream"}
                </Button>
              </div>
            </form>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold">Embed</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Put this player inside the partner platform.
            </p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => void copyEmbed()}>
                <Copy className="size-4" aria-hidden="true" />
                Copy URL
              </Button>
              <a
                href={data.stream.embedPath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open
              </a>
            </div>
          </section>

          {message && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              {message}
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
