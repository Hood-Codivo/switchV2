import { NextRequest, NextResponse } from "next/server"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL

export function getInfrastructureOrigin(request: NextRequest) {
  return new URL(request.url).origin
}

export function getConvexClient() {
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured")
  }
  return new ConvexHttpClient(CONVEX_URL)
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function getApiKeyHash(request: NextRequest) {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  const apiKey = header.slice("Bearer ".length).trim()
  if (!apiKey) return null
  return sha256Hex(apiKey)
}

export function unauthorized() {
  return NextResponse.json(
    {
      error: {
        code: "unauthorized",
        message: "Send your Switched Infrastructure API key as a Bearer token.",
      },
    },
    { status: 401 },
  )
}

export function apiError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Request failed"
  return NextResponse.json({ error: { code: "request_failed", message } }, { status })
}

export function streamIdFromParam(streamId: string) {
  return streamId as Id<"infrastructureStreams">
}

export const infrastructureApi = api.infrastructure
