import { NextRequest, NextResponse } from "next/server"
import { verifyAccessToken } from "@privy-io/node"
import { createRemoteJWKSet } from "jose"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!
const PRIVY_JWKS = createRemoteJWKSet(
  new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`),
)

export async function GET(request: NextRequest) {
  // Extract and verify the user's Privy token from the cookie
  const token = request.cookies.get("privy-token")?.value
  if (!token) {
    return NextResponse.redirect(new URL("/sign-in", request.url))
  }

  let privyDid: string
  try {
    const verified = await verifyAccessToken({
      access_token: token,
      app_id: PRIVY_APP_ID,
      verification_key: PRIVY_JWKS,
    })
    privyDid = verified.user_id
  } catch {
    return NextResponse.redirect(new URL("/sign-in", request.url))
  }

  // Call Convex action to generate the OAuth URL with signed state
  const client = new ConvexHttpClient(CONVEX_URL)
  const { authUrl } = await client.action(api.connectedPlatformsActions.generateYoutubeAuthUrl, {
    privyDid,
  })

  return NextResponse.redirect(authUrl)
}
