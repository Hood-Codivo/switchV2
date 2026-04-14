import { NextRequest, NextResponse } from "next/server"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import { verifyState } from "@/convex/lib/tokenEncryption"

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!
const STATE_MAX_AGE_SECONDS = 600 // 10 minutes

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const settingsUrl = new URL("/dashboard/settings/stream", request.url)

  // Google returned an error (user denied consent, etc.)
  if (error) {
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", error)
    return NextResponse.redirect(settingsUrl)
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", "missing_params")
    return NextResponse.redirect(settingsUrl)
  }

  // Validate the HMAC-signed state.
  // State format: "${privyDid}:${timestamp}:${hmac}"
  // Privy DIDs contain colons (e.g., "did:privy:abc123"), so we split
  // from the right: the last segment is the HMAC, the second-to-last
  // is the timestamp, and everything before is the Privy DID.
  const lastColon = state.lastIndexOf(":")
  if (lastColon === -1) {
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", "invalid_state")
    return NextResponse.redirect(settingsUrl)
  }
  const hmac = state.slice(lastColon + 1)
  const payload = state.slice(0, lastColon) // "privyDid:timestamp"

  const secondLastColon = payload.lastIndexOf(":")
  if (secondLastColon === -1) {
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", "invalid_state")
    return NextResponse.redirect(settingsUrl)
  }
  const privyDid = payload.slice(0, secondLastColon)
  const timestamp = parseInt(payload.slice(secondLastColon + 1), 10)

  if (!verifyState(payload, hmac)) {
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", "invalid_signature")
    return NextResponse.redirect(settingsUrl)
  }

  // Check timestamp freshness
  const age = Math.floor(Date.now() / 1000) - timestamp
  if (age > STATE_MAX_AGE_SECONDS || age < 0) {
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", "expired_state")
    return NextResponse.redirect(settingsUrl)
  }

  // Exchange the code for tokens via Convex action
  const client = new ConvexHttpClient(CONVEX_URL)
  try {
    await client.action(api.connectedPlatformsActions.exchangeYoutubeCode, {
      code,
      privyDid,
    })
    settingsUrl.searchParams.set("youtube", "connected")
  } catch (err) {
    console.error("YouTube OAuth exchange failed:", err)
    settingsUrl.searchParams.set("youtube", "error")
    settingsUrl.searchParams.set("reason", "exchange_failed")
  }

  return NextResponse.redirect(settingsUrl)
}
