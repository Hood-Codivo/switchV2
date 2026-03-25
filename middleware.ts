import { NextRequest, NextResponse } from "next/server"
import { verifyAccessToken } from "@privy-io/node"
import { createRemoteJWKSet } from "jose"

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID
const PRIVY_JWKS = PRIVY_APP_ID
  ? createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/.well-known/jwks.json`),
    )
  : null

const protectedRoutes = ["/dashboard", "/settings"]
const signInRoute = "/sign-in"

function isProtectedRoute(pathname: string) {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

/**
 * Determines auth state from the Privy cookie.
 *
 * Returns:
 *   "authenticated"   — valid privy-token cookie verified via JWKS
 *   "unauthenticated" — no privy-token cookie at all (definitely not logged in)
 *   "unknown"         — cookie exists but verification failed, or no JWKS config;
 *                        let client-side auth decide
 */
async function getAuthState(
  request: NextRequest,
): Promise<"authenticated" | "unauthenticated" | "unknown"> {
  const token = request.cookies.get("privy-token")?.value

  if (!token) {
    // No cookie — could be localStorage mode (token in JS, invisible to middleware)
    // or genuinely unauthenticated. Check for Privy session indicators.
    const hasPrivySession =
      request.cookies.get("privy-session")?.value ||
      request.cookies.get("privy-id-token")?.value ||
      request.cookies.get("privy-refresh-token")?.value
    return hasPrivySession ? "unknown" : "unauthenticated"
  }

  if (!PRIVY_APP_ID || !PRIVY_JWKS) return "unknown"

  try {
    await verifyAccessToken({
      access_token: token,
      app_id: PRIVY_APP_ID,
      verification_key: PRIVY_JWKS,
    })
    return "authenticated"
  } catch {
    return "unknown"
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authState = await getAuthState(request)

  // Only redirect away from protected routes if we're SURE the user is unauthenticated.
  // "unknown" means we can't tell from middleware — let client-side handle it.
  if (isProtectedRoute(pathname) && authState === "unauthenticated") {
    return NextResponse.redirect(new URL(signInRoute, request.url))
  }

  // Redirect authenticated users away from sign-in page
  if (pathname === signInRoute && authState === "authenticated") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
}
