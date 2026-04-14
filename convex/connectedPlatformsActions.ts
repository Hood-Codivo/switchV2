"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { internal } from "./_generated/api"
import { encrypt, decrypt, signState } from "./lib/tokenEncryption"

const platformValidator = v.union(v.literal("youtube"), v.literal("x"))

// ─── Actions (external API calls) ───────────────────────────────────────────

export const generateYoutubeAuthUrl = action({
  args: { privyDid: v.string() },
  handler: async (_ctx, { privyDid }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI
    if (!clientId || !redirectUri) {
      throw new Error("YouTube OAuth not configured: missing GOOGLE_CLIENT_ID or YOUTUBE_REDIRECT_URI")
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const payload = `${privyDid}:${timestamp}`
    const hmac = signState(payload)
    const state = `${payload}:${hmac}`

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.force-ssl")
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")
    url.searchParams.set("state", state)

    return { authUrl: url.toString() }
  },
})

export const exchangeYoutubeCode = action({
  args: { code: v.string(), privyDid: v.string() },
  handler: async (ctx, { code, privyDid }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("YouTube OAuth not configured")
    }

    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      throw new Error(`Token exchange failed: ${tokenRes.status} — ${err}`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    if (!tokens.refresh_token) {
      throw new Error("No refresh token received — user may need to revoke and reconnect")
    }

    // Fetch channel info
    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    )

    if (!channelRes.ok) {
      throw new Error(`Failed to fetch YouTube channel info: ${channelRes.status}`)
    }

    const channelData = (await channelRes.json()) as {
      items?: Array<{ id: string; snippet: { title: string } }>
    }

    const channel = channelData.items?.[0]
    if (!channel) {
      throw new Error("No YouTube channel found for this account")
    }

    // Resolve Privy DID to Convex user ID
    const user = await ctx.runQuery(internal.connectedPlatforms.getUserByPrivyDid, {
      privyDid,
    })
    if (!user) throw new Error("User not found for Privy DID")

    // Encrypt tokens and store
    const encryptedAccess = encrypt(tokens.access_token)
    const encryptedRefresh = encrypt(tokens.refresh_token)

    await ctx.runMutation(internal.connectedPlatforms.storeConnection, {
      userId: user._id,
      platform: "youtube",
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      channelId: channel.id,
      channelTitle: channel.snippet.title,
      displayName: channel.snippet.title,
      connectedAt: Date.now(),
      status: "active",
    })
  },
})

export const refreshYoutubeToken = action({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error("YouTube OAuth not configured")
    }

    const connection = await ctx.runQuery(
      internal.connectedPlatforms.getRawConnection,
      { connectionId },
    )
    if (!connection || !connection.refreshToken) {
      throw new Error("No refresh token available")
    }

    // Check if token is still fresh (more than 5 minutes remaining)
    if (connection.tokenExpiresAt && connection.tokenExpiresAt > Date.now() + 5 * 60_000) {
      return
    }

    const decryptedRefresh = decrypt(connection.refreshToken)

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: decryptedRefresh,
        grant_type: "refresh_token",
      }),
    })

    if (!tokenRes.ok) {
      await ctx.runMutation(internal.connectedPlatforms.markExpired, { connectionId })
      throw new Error("YouTube token refresh failed — connection marked as expired")
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      expires_in: number
    }

    const encryptedAccess = encrypt(tokens.access_token)

    await ctx.runMutation(internal.connectedPlatforms.updateTokens, {
      connectionId,
      accessToken: encryptedAccess,
      tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    })
  },
})

export const disconnectPlatform = action({
  args: { platform: platformValidator },
  handler: async (ctx, { platform }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.runQuery(internal.connectedPlatforms.getUserByPrivyDid, {
      privyDid: identity.subject,
    })
    if (!user) throw new Error("User not found")

    const connection = await ctx.runQuery(
      internal.connectedPlatforms.getRawConnectionByUserAndPlatform,
      { userId: user._id, platform },
    )
    if (!connection) throw new Error("No connection found for this platform")

    // Revoke token on Google's side (best effort)
    if (platform === "youtube" && connection.accessToken) {
      try {
        const decryptedAccess = decrypt(connection.accessToken)
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptedAccess)}`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        )
      } catch {
        // Revocation is best-effort — proceed with deletion even if it fails
      }
    }

    await ctx.runMutation(internal.connectedPlatforms.removeConnection, {
      connectionId: connection._id,
    })
  },
})
