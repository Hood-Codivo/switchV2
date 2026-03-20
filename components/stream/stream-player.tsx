"use client"

import { useEffect, useRef } from "react"
import Hls from "hls.js"
import { Users } from "lucide-react"

type StreamPlayerProps = {
  hlsUrl: string
  title: string
  category: string
  viewerCount: number
}

export function StreamPlayer({ hlsUrl, title, category, viewerCount }: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true })
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
      })
      return () => {
        hls.destroy()
      }
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS support
      const onLoaded = () => { video.play().catch(() => {}) }
      video.src = hlsUrl
      video.addEventListener("loadedmetadata", onLoaded)
      return () => {
        video.removeEventListener("loadedmetadata", onLoaded)
        video.src = ""
      }
    }
  }, [hlsUrl])

  return (
    <div className="relative w-full">
      <video
        ref={videoRef}
        controls
        playsInline
        className="aspect-video w-full rounded-xl bg-black"
      />
      {/* LIVE badge overlay */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
        <span className="size-1.5 animate-pulse rounded-full bg-white" />
        LIVE
      </div>
      {/* Metadata bar */}
      <div className="mt-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{category}</p>
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="size-3.5" />
          <span>{viewerCount.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
