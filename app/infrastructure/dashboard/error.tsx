"use client"

import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw, Terminal } from "lucide-react"

export default function InfrastructureDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isMissingConvexFunction = error.message.includes(
    "Could not find public function",
  )

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5">
      <div className="flex items-center gap-2 text-destructive">
        <AlertCircle className="size-4" aria-hidden="true" />
        <h1 className="text-sm font-semibold">
          {isMissingConvexFunction
            ? "Infrastructure backend is not synced"
            : "Infrastructure dashboard could not load"}
        </h1>
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        {isMissingConvexFunction
          ? "The frontend has the new infrastructure code, but the Convex dev deployment does not have the new functions yet."
          : "Try again after checking your local server and Convex deployment."}
      </p>
      {isMissingConvexFunction && (
        <div className="mt-4 rounded-md border border-border bg-background p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Terminal className="size-4" aria-hidden="true" />
            Run this in your terminal
          </div>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <code>pnpm exec convex dev --once</code>
          </pre>
        </div>
      )}
      <Button type="button" variant="outline" className="mt-4" onClick={reset}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}
