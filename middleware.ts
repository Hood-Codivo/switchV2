import { NextRequest, NextResponse } from "next/server"
import { verifyAccessToken } from "@privy-io/node"
import { createRemoteJWKSet } from "jose"

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!
const PRIVY_JWKS = createRemoteJWKSet(
  new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/.well-known/jwks.json`),
)

const protectedRoutes = ["/dashboard", "/settings"]
const signInRoute = "/sign-in"

function isProtectedRoute(pathname: string) {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get("privy-token")?.value

  let isAuthenticated = false

  if (token) {
    try {
      await verifyAccessToken({
        access_token: token,
        app_id: PRIVY_APP_ID,
        verification_key: PRIVY_JWKS,
      })
      isAuthenticated = true
    } catch {
      // Token invalid or expired — treat as unauthenticated
    }
  }

  if (isProtectedRoute(pathname) && !isAuthenticated) {
    return NextResponse.redirect(new URL(signInRoute, request.url))
  }

  if (pathname === signInRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
}
