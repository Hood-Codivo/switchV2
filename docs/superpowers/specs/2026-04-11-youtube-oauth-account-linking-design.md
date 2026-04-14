# YouTube OAuth Account Linking for Simulcast

**Date:** 2026-04-11
**GitHub Issue:** #47
**Status:** Design approved

## Overview

Add YouTube OAuth account linking so that Switched creators can connect their YouTube channels and later simulcast streams to YouTube. This is the foundation layer — account linking, credential storage, and UI — that the actual RTMP simulcast feature will build on.

X (Twitter) integration is deferred to a follow-up issue. The schema and architecture are designed to support it additively.

## Architecture

**Approach:** Convex-centric. All token handling (exchange, encryption, storage, refresh, revocation) lives in Convex actions. The only Next.js piece is a thin API route that receives Google's OAuth callback redirect and forwards the authorization code to a Convex action.

**Why this approach:**
- Follows the existing codebase pattern where all external API calls happen in Convex actions
- Tokens never persist on the Next.js server
- Token refresh logic co-locates with where tokens are stored and used

## Schema

New `connectedPlatforms` table in `convex/schema.ts`:

```ts
connectedPlatforms: defineTable({
  userId: v.id("users"),
  platform: v.union(v.literal("youtube"), v.literal("x")),

  // OAuth tokens (encrypted before storage with AES-256-GCM)
  accessToken: v.optional(v.string()),
  refreshToken: v.optional(v.string()),
  tokenExpiresAt: v.optional(v.number()),

  // Manual RTMP (for X later)
  rtmpUrl: v.optional(v.string()),
  streamKey: v.optional(v.string()),

  // Platform-specific metadata
  channelId: v.optional(v.string()),
  channelTitle: v.optional(v.string()),

  // Common
  displayName: v.optional(v.string()),
  connectedAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  status: v.union(
    v.literal("active"),
    v.literal("expired"),
    v.literal("revoked"),
  ),
})
  .index("by_user", ["userId"])
  .index("by_user_and_platform", ["userId", "platform"])
```

Design notes:
- Flat table with optional fields per platform type (OAuth fields for YouTube, RTMP fields for X later)
- Indexes on `[userId]` and `[userId, platform]` for fast lookups
- `status` tracks connection health: `active` (working), `expired` (token refresh failed), `revoked` (user disconnected)

## OAuth Flow

### Step-by-step sequence

1. Creator clicks "Connect YouTube" in dashboard settings → client navigates to `/api/auth/youtube`
2. `app/api/auth/youtube/route.ts` calls `generateYoutubeAuthUrl` Convex action
3. Action builds Google OAuth URL with:
   - `client_id` from `process.env.GOOGLE_CLIENT_ID`
   - `redirect_uri` from `process.env.YOUTUBE_REDIRECT_URI`
   - `scope`: `https://www.googleapis.com/auth/youtube.force-ssl`
   - `response_type`: `code`
   - `access_type`: `offline` (to get a refresh token)
   - `prompt`: `consent` (force consent to always get refresh token)
   - `state`: signed CSRF token containing the user's Privy DID
4. API route redirects user to the Google OAuth URL
5. User consents on Google's screen
6. Google redirects to `app/api/auth/youtube/callback/route.ts` with `code` and `state` params
7. Callback route validates `state` (CSRF check), then calls `exchangeYoutubeCode` Convex action with the code
8. Convex action:
   - Exchanges code for tokens via `POST https://oauth2.googleapis.com/token`
   - Fetches channel info via `GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`
   - Encrypts `access_token` and `refresh_token` with AES-256-GCM
   - Stores encrypted tokens + channel metadata in `connectedPlatforms`
9. Callback route redirects user to `/dashboard/settings/stream?youtube=connected`

### CSRF protection

The `state` parameter is an HMAC-signed value (using `TOKEN_ENCRYPTION_KEY`) containing the user's Privy DID and a timestamp. The flow works as follows:

1. The `/api/auth/youtube` route extracts the user's Privy DID from their session cookie (using Privy's server-side verification)
2. It builds `state` as `${privyDid}:${timestamp}:${hmac}` where the HMAC covers the DID + timestamp
3. On callback, `/api/auth/youtube/callback` verifies the HMAC signature and checks the timestamp is within a reasonable window (e.g., 10 minutes)
4. The verified Privy DID from `state` is passed to the `exchangeYoutubeCode` Convex action so it knows which user to store tokens for

This prevents an attacker from tricking a user into linking the attacker's YouTube account. The callback route does not need Convex auth context — the signed state carries the authenticated identity from the initiation step.

### Token refresh

Before any YouTube API usage, call `refreshYoutubeToken` action:
1. Query the `connectedPlatforms` row for the user's YouTube connection
2. Check if `tokenExpiresAt` is within 5 minutes of now
3. If so, decrypt the refresh token, call `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token`
4. Encrypt the new access token, update `tokenExpiresAt`
5. If refresh fails (token revoked by user on Google's side), update `status` to `expired`

### Disconnect

When a creator disconnects YouTube:
1. Decrypt the access token
2. Call `POST https://oauth2.googleapis.com/revoke?token={accessToken}` to revoke on Google's side
3. Delete the row from `connectedPlatforms`

## Token Encryption

### Utility: `convex/lib/token-encryption.ts`

Two functions:
- `encrypt(plaintext: string): string` — AES-256-GCM encryption using `process.env.TOKEN_ENCRYPTION_KEY`. Returns base64-encoded string containing IV (12 bytes) + ciphertext + auth tag (16 bytes).
- `decrypt(encrypted: string): string` — Decodes base64, extracts IV, ciphertext, and auth tag, decrypts and returns plaintext.

### Why AES-256-GCM
- GCM mode provides authenticated encryption — tampered ciphertext fails decryption rather than producing garbage
- Fresh IV per encryption prevents pattern analysis
- Node.js `crypto` module is built-in, no npm dependencies needed
- Available in Convex `"use node"` actions

### Key management
- Single env var: `TOKEN_ENCRYPTION_KEY` (32-byte hex string, 64 hex characters)
- Used for all platform tokens (YouTube now, X later)
- Generate with: `openssl rand -hex 32`

## New Files

### Convex Backend: `convex/connected-platforms.ts`

**Actions (external API calls):**
- `generateYoutubeAuthUrl` — Builds and returns Google OAuth URL with CSRF state token
- `exchangeYoutubeCode` — Exchanges authorization code for tokens, fetches channel info, encrypts and stores
- `refreshYoutubeToken` — Refreshes expired access tokens
- `disconnectPlatform` — Revokes tokens on Google, deletes the connection row

**Queries:**
- `getConnectedPlatforms` — Returns all connected platforms for the authenticated user. Strips encrypted token fields — only returns `platform`, `displayName`, `channelTitle`, `status`, `connectedAt`.
- `getPlatformByType` — Returns a single platform connection by type for the authenticated user. Strips tokens.

**Internal mutations (not client-callable):**
- `storeConnection` — Writes a new row to `connectedPlatforms`
- `updateTokens` — Updates encrypted tokens and `tokenExpiresAt`
- `removeConnection` — Deletes a row from `connectedPlatforms`

### Encryption Utility: `convex/lib/token-encryption.ts`

- `encrypt(plaintext: string): string`
- `decrypt(encrypted: string): string`

### API Routes

- `app/api/auth/youtube/route.ts` — `GET` handler that calls `generateYoutubeAuthUrl` and redirects to Google
- `app/api/auth/youtube/callback/route.ts` — `GET` handler that receives Google's redirect, validates state, calls `exchangeYoutubeCode`, redirects to settings

### UI Changes (modified files)

- `app/dashboard/settings/stream/page.tsx` — Add "Connected Platforms" section with YouTube connect/disconnect card
- `components/studio/go-live-modal.tsx` — Add "Destinations" section above the Go Live button with Switched (always on) and YouTube (toggle)

## UI Design

### Dashboard Settings — Stream Page

New "Connected Platforms" section at the top of the stream settings page:

**Disconnected state:**
- YouTube icon (red) + "YouTube" label + "Connect" button
- Clicking navigates to `/api/auth/youtube` to start OAuth

**Connected state:**
- YouTube icon (red) + channel name + green "Active" badge + "Disconnect" button
- Disconnect opens a confirmation dialog, then calls `disconnectPlatform`

**Post-OAuth return:**
- Read `?youtube=connected` or `?youtube=error` from URL params
- Show success or error toast notification

### Go-Live Modal — Destinations

Added above the Go Live button, below billing:

- **Switched** — Platform logo + "Switched" label. Always shown, no toggle (enforces "platform always receives the stream" rule).
- **YouTube** — YouTube icon + channel name + toggle switch. Only shown if user has an `active` YouTube connection. Default: on.
- **No platforms connected** — Subtle text link: "Connect platforms in Settings" → `/dashboard/settings/stream`

The toggle state is local to the modal. Passed to `onConfirm()` alongside title, category, and billing plan so the go-live action knows which destinations to activate. The actual simulcast logic (creating YouTube broadcasts, pushing RTMP) is out of scope for this issue.

## Environment Variables

```
# YouTube OAuth
GOOGLE_CLIENT_ID=               # Google Cloud OAuth 2.0 client ID
GOOGLE_CLIENT_SECRET=           # Google Cloud OAuth 2.0 client secret
YOUTUBE_REDIRECT_URI=           # http://localhost:3000/api/auth/youtube/callback (dev)

# Token Encryption
TOKEN_ENCRYPTION_KEY=           # 32-byte hex string (openssl rand -hex 32)
```

### Google Cloud Setup

1. Enable YouTube Data API v3 in Google Cloud Console
2. Configure OAuth consent screen with `youtube.force-ssl` scope
3. Create OAuth 2.0 credentials (Web application type)
4. Add authorized redirect URI for dev and production

## Security

- **Token encryption:** AES-256-GCM before storage in Convex. Tokens are never stored in plain text.
- **CSRF protection:** Signed `state` parameter with timestamp. Validated on callback.
- **Token exposure:** Encrypted tokens never sent to the client. Queries strip token fields.
- **Revocation on disconnect:** Google's revoke endpoint is called before deleting credentials.
- **Server-side only:** All YouTube API calls and token operations happen in Convex `"use node"` actions, never in client code.
- **Refresh token handling:** `access_type=offline` and `prompt=consent` ensure we always receive a refresh token.

## Out of Scope

- **RTMP simulcast** — Actually pushing stream data to YouTube. This issue only stores credentials. A follow-up issue will handle `liveBroadcasts.insert` → `liveStreams.insert` → bind → RTMP push.
- **X (Twitter) integration** — Deferred pending Periscope Producer API / enterprise access investigation. Schema supports it.
- **LinkedIn** — Can be added later following the same OAuth pattern.
- **Dashboard settings page beyond stream** — Connected accounts management in `/dashboard/settings/account` is future work.

## Dependencies

- Google Cloud project with YouTube Data API v3 enabled
- OAuth 2.0 credentials (client ID + secret)
- `TOKEN_ENCRYPTION_KEY` environment variable
- Convex `"use node"` runtime for crypto operations
