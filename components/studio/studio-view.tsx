"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useStudio } from "@/hooks/use-studio"

export function StudioView() {
  const studio = useStudio()
  const { status, error, startSession } = studio
  const router = useRouter()

  // Once connected, hand off to /studio/[sessionId].
  // StudioConnected is now rendered there, not here.
  useEffect(() => {
    if (studio.status === "connected" && studio.sessionId) {
      router.push(`/studio/${studio.sessionId}`)
    }
  }, [studio.status, studio.sessionId, router])

  // ── Pre-join / connecting / error ───────────────────────────────────────────

  if (status !== "connected") {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
        {status === "idle" && (
          <div className="flex flex-col items-center gap-6 text-center">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Stream Studio</h1>
              <p className="mt-2 text-sm text-zinc-400">
                Your browser will ask for camera and microphone access.
              </p>
            </div>
            <button
              onClick={() => void startSession()}
              className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-100"
            >
              Enter Studio
            </button>
          </div>
        )}

        {(status === "requesting-session" || status === "connecting") && (
          <div className="flex flex-col items-center gap-4">
            <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
            <p className="text-sm text-zinc-400">
              {status === "requesting-session"
                ? "Setting up your session…"
                : "Connecting to studio…"}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => void startSession()}
              className="rounded-full bg-white px-6 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Connected: redirect in progress ──────────────────────────────────────────
  // The useEffect above will redirect to /studio/[sessionId].
  // Show a spinner while the navigation completes.

  if (status === "connected") {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
        <div className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </div>
    )
  }
}
