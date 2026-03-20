import { useEffect, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export function useStreamViewer(streamId: Id<"streams"> | undefined): void {
  const sessionIdRef = useRef<string>(crypto.randomUUID())

  const join = useMutation(api.streamViewers.join)
  const heartbeat = useMutation(api.streamViewers.heartbeat)
  const leave = useMutation(api.streamViewers.leave)

  useEffect(() => {
    if (!streamId) return

    const sessionId = sessionIdRef.current

    void join({ streamId, sessionId })

    const interval = setInterval(() => {
      void heartbeat({ sessionId })
    }, 30_000)

    return () => {
      clearInterval(interval)
      void leave({ sessionId })
    }
  // Convex mutation objects are referentially stable across renders (guaranteed
  // by the Convex React contract), so they are intentionally omitted from the
  // dependency array. The only real dependency is streamId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId])
}
