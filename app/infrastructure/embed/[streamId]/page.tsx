"use client"

import { use } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { AlertCircle, Radio, Signal, Video } from "lucide-react"

export default function InfrastructureEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ streamId: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const streamId = use(params).streamId as Id<"infrastructureStreams">
  const token = use(searchParams).token ?? ""
  const access = useQuery(api.infrastructure.getStreamByAccessToken, { token })
  const fallback = useQuery(api.infrastructure.getEmbedStream, { streamId })
  const data = access?.stream.id === streamId ? access : fallback

  if (data === undefined) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="h-48 w-full max-w-3xl animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            <h1 className="text-sm font-semibold">Stream unavailable</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            This embed link is invalid or the stream has been removed.
          </p>
        </div>
      </div>
    )
  }

  const stream = data.stream

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">{data.organization.name}</p>
            <h1 className="text-sm font-semibold">{stream.title}</h1>
          </div>
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            <Signal className="size-3.5" aria-hidden="true" />
            {stream.status}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          {stream.status === "live" && stream.playbackUrl ? (
            <video
              className="aspect-video w-full max-w-5xl rounded-lg bg-black"
              src={stream.playbackUrl}
              controls
              playsInline
              autoPlay
            />
          ) : (
            <div className="flex aspect-video w-full max-w-5xl flex-col items-center justify-center rounded-lg border border-border bg-card p-6 text-center">
              {stream.status === "live" ? (
                <Radio className="size-10 text-red-300" aria-hidden="true" />
              ) : (
                <Video className="size-10 text-muted-foreground" aria-hidden="true" />
              )}
              <p className="mt-4 text-lg font-semibold">
                {stream.status === "live" ? "Live stream is starting" : "Stream is offline"}
              </p>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {stream.status === "live"
                  ? "Playback will appear here as soon as the platform provides the HLS URL."
                  : "This player is ready. The platform controls when the stream goes live."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
