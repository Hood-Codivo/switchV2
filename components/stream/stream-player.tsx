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

export function StreamPlayer({ hlsUrl, viewerCount }: StreamPlayerProps) {
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
    <div className="group relative w-full overflow-hidden">
      <video
        ref={videoRef}
        controls
        playsInline
        className="aspect-video w-full"
      />

      {/* Top-left overlay: LIVE + viewer count */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white shadow-lg">
          <span className="size-1.5 animate-pulse rounded-full bg-white" />
          LIVE
        </span>
        <span className="flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          <Users className="size-3" />
          {viewerCount.toLocaleString()} Viewers
        </span>
      </div>
    </div>
  )
}
