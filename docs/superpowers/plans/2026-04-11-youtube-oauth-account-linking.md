# YouTube OAuth Account Linking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Switched creators connect their YouTube channel via OAuth so the platform can later create live broadcasts on their behalf.

**Architecture:** Convex-centric — all token handling (exchange, encryption, storage, refresh, revocation) lives in Convex `"use node"` actions. Two thin Next.js API routes handle the OAuth redirect flow. A new `connectedPlatforms` table stores encrypted credentials. UI surfaces in dashboard settings (manage) and go-live modal (per-stream toggle).

**Tech Stack:** Convex (schema, actions, queries, mutations), Next.js API routes, Node.js `crypto` (AES-256-GCM), Google OAuth 2.0, YouTube Data API v3, Privy server-side token verification, shadcn/ui components.

**Spec:** `docs/superpowers/specs/2026-04-11-youtube-oauth-account-linking-design.md`
**GitHub Issue:** #47

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `convex/lib/token-encryption.ts` | AES-256-GCM encrypt/decrypt utility |
| Create | `convex/connected-platforms.ts` | Queries and internal mutations (V8 runtime) |
| Create | `convex/connected-platforms-actions.ts` | Actions calling Google APIs (Node runtime, `"use node"`) |
| Create | `app/api/auth/youtube/route.ts` | OAuth initiation — redirects to Google |
| Create | `app/api/auth/youtube/callback/route.ts` | OAuth callback — receives code, calls Convex action |
| Modify | `convex/schema.ts` | Add `connectedPlatforms` table |
| Modify | `app/dashboard/settings/stream/page.tsx` | Add "Connected Platforms" section |
| Modify | `components/studio/go-live-modal.tsx` | Add "Destinations" section with YouTube toggle |
| Create | `convex/__tests__/connected-platforms.test.ts` | Tests for queries, mutations, encryption |

---

### Task 1: Schema — Add `connectedPlatforms` table

**Files:**
- Modify: `convex/schema.ts:46-234`

- [ ] **Step 1: Add the `connectedPlatforms` table to the schema**

Open `convex/schema.ts`. Add the new table definition inside `defineSchema({})`, after the `users` table (before the closing `})`:

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
    .index("by_user_and_platform", ["userId", "platform"]),
```

- [ ] **Step 2: Verify the schema is valid**

Run: `pnpm typecheck`
Expected: No type errors related to the schema.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add connectedPlatforms table to schema"
```

---

### Task 2: Token encryption utility

**Files:**
- Create: `convex/lib/token-encryption.ts`

- [ ] **Step 1: Write the encryption test**

Create `convex/__tests__/token-encryption.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { encrypt, decrypt } from "../lib/token-encryption"

// Set a test encryption key (32 bytes = 64 hex chars)
const TEST_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"

describe("token-encryption", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY)
  })

  it("encrypts and decrypts a token round-trip", () => {
    const plaintext = "ya29.a0AfH6SMBx-test-access-token"
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it("produces different ciphertext for the same input (random IV)", () => {
    const plaintext = "ya29.a0AfH6SMBx-test-access-token"
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("some-token")
    // Flip a character in the middle of the ciphertext
    const tampered =
      encrypted.slice(0, Math.floor(encrypted.length / 2)) +
      "X" +
      encrypted.slice(Math.floor(encrypted.length / 2) + 1)
    expect(() => decrypt(tampered)).toThrow()
  })

  it("throws if TOKEN_ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "")
    expect(() => encrypt("token")).toThrow("TOKEN_ENCRYPTION_KEY")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run convex/__tests__/token-encryption.test.ts`
Expected: FAIL — module `../lib/token-encryption` not found.

- [ ] **Step 3: Implement the encryption utility**

Create `convex/lib/token-encryption.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "crypto"

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)")
  }
  return Buffer.from(hex, "hex")
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns a base64 string: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, authTag]).toString("base64")
}

/**
 * Decrypts a base64 string produced by `encrypt()`.
 */
export function decrypt(encrypted: string): string {
  const key = getKey()
  const buf = Buffer.from(encrypted, "base64")
  const iv = buf.subarray(0, 12)
  const authTag = buf.subarray(buf.length - 16)
  const ciphertext = buf.subarray(12, buf.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext) + decipher.final("utf8")
}

/**
 * Creates an HMAC-SHA256 signature for OAuth state parameters.
 */
export function signState(payload: string): string {
  const key = getKey()
  return createHmac("sha256", key).update(payload).digest("hex")
}

/**
 * Verifies an HMAC-SHA256 signature for OAuth state parameters.
 */
export function verifyState(payload: string, signature: string): boolean {
  const expected = signState(payload)
  if (expected.length !== signature.length) return false
  // Constant-time comparison
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run convex/__tests__/token-encryption.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Add tests for signState/verifyState**

Add to `convex/__tests__/token-encryption.test.ts`:

```ts
import { signState, verifyState } from "../lib/token-encryption"

describe("state signing", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY)
  })

  it("signs and verifies a state payload", () => {
    const payload = "did:privy:abc123:1712345678"
    const sig = signState(payload)
    expect(verifyState(payload, sig)).toBe(true)
  })

  it("rejects a tampered payload", () => {
    const payload = "did:privy:abc123:1712345678"
    const sig = signState(payload)
    expect(verifyState("did:privy:evil:1712345678", sig)).toBe(false)
  })

  it("rejects a tampered signature", () => {
    const payload = "did:privy:abc123:1712345678"
    const sig = signState(payload)
    expect(verifyState(payload, sig.replace(sig[0], "0"))).toBe(false)
  })
})
```

- [ ] **Step 6: Run all encryption tests**

Run: `pnpm vitest run convex/__tests__/token-encryption.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add convex/lib/token-encryption.ts convex/__tests__/token-encryption.test.ts
git commit -m "feat: add AES-256-GCM token encryption and HMAC state signing utilities"
```

---

### Task 3: Convex backend — internal mutations and queries

**Files:**
- Create: `convex/connected-platforms.ts`
- Create: `convex/__tests__/connected-platforms.test.ts`

- [ ] **Step 1: Write tests for the internal mutations and queries**

Create `convex/__tests__/connected-platforms.test.ts`:

```ts
import { convexTest } from "convex-test"
import { expect, it, describe } from "vitest"
import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { api, internal } from "../_generated/api"
import schema from "../schema"

const modules = import.meta.glob("../**/*.ts")

async function seedUser(
  ctx: GenericMutationCtx<DataModel>,
  username: string,
): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    privyDid: `did:privy:test-${username}`,
    walletAddress: `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV${username}`,
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    pointsBalance: 0,
    followerCount: 0,
    createdAt: Date.now(),
  })
}

describe("connected-platforms mutations", () => {
  it("stores a YouTube connection and retrieves it without tokens", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "alice"))

    // Store a connection via internal mutation
    await t.run(async (ctx) => {
      await ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "youtube",
        accessToken: "encrypted-access",
        refreshToken: "encrypted-refresh",
        tokenExpiresAt: Date.now() + 3600_000,
        channelId: "UC1234",
        channelTitle: "Alice's Channel",
        displayName: "Alice's Channel",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    // Query via the public query — should strip tokens
    const platforms = await t
      .withIdentity({ subject: "did:privy:test-alice" })
      .query(api.connectedPlatforms.getConnectedPlatforms, {})

    expect(platforms).toHaveLength(1)
    expect(platforms[0].platform).toBe("youtube")
    expect(platforms[0].channelTitle).toBe("Alice's Channel")
    expect(platforms[0].displayName).toBe("Alice's Channel")
    expect(platforms[0].status).toBe("active")
    // Tokens must NOT be returned
    expect(platforms[0]).not.toHaveProperty("accessToken")
    expect(platforms[0]).not.toHaveProperty("refreshToken")
  })

  it("retrieves a single platform by type", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "bob"))

    await t.run(async (ctx) => {
      await ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "youtube",
        channelId: "UC5678",
        channelTitle: "Bob Streams",
        displayName: "Bob Streams",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    const yt = await t
      .withIdentity({ subject: "did:privy:test-bob" })
      .query(api.connectedPlatforms.getPlatformByType, { platform: "youtube" })

    expect(yt).not.toBeNull()
    expect(yt?.channelTitle).toBe("Bob Streams")
    expect(yt).not.toHaveProperty("accessToken")
  })

  it("returns null for a platform the user has not connected", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => seedUser(ctx, "carol"))

    const yt = await t
      .withIdentity({ subject: "did:privy:test-carol" })
      .query(api.connectedPlatforms.getPlatformByType, { platform: "youtube" })

    expect(yt).toBeNull()
  })

  it("removes a connection", async () => {
    const t = convexTest(schema, modules)
    const userId = await t.run(async (ctx) => seedUser(ctx, "dave"))

    const connectionId = await t.run(async (ctx) => {
      return ctx.db.insert("connectedPlatforms", {
        userId,
        platform: "youtube",
        channelId: "UC9999",
        channelTitle: "Dave Live",
        displayName: "Dave Live",
        connectedAt: Date.now(),
        status: "active",
      })
    })

    await t.mutation(internal.connectedPlatforms.removeConnection, {
      connectionId,
    })

    const platforms = await t
      .withIdentity({ subject: "did:privy:test-dave" })
      .query(api.connectedPlatforms.getConnectedPlatforms, {})

    expect(platforms).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run convex/__tests__/connected-platforms.test.ts`
Expected: FAIL — module `api.connectedPlatforms` not found.

- [ ] **Step 3: Implement the Convex queries and internal mutations**

Create `convex/connected-platforms.ts`:

```ts
import { v } from "convex/values"
import { internalMutation, internalQuery, query } from "./_generated/server"
import { getAuthenticatedUser } from "./auth"

const platformValidator = v.union(v.literal("youtube"), v.literal("x"))

// ─── Queries ────────────────────────────────────────────────────────────────

export const getConnectedPlatforms = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthenticatedUser(ctx)

    const connections = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()

    return connections.map((c) => ({
      _id: c._id,
      platform: c.platform,
      channelId: c.channelId,
      channelTitle: c.channelTitle,
      displayName: c.displayName,
      connectedAt: c.connectedAt,
      lastUsedAt: c.lastUsedAt,
      status: c.status,
    }))
  },
})

export const getPlatformByType = query({
  args: { platform: platformValidator },
  handler: async (ctx, { platform }) => {
    const userId = await getAuthenticatedUser(ctx)

    const connection = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) =>
        q.eq("userId", userId).eq("platform", platform),
      )
      .first()

    if (!connection) return null

    return {
      _id: connection._id,
      platform: connection.platform,
      channelId: connection.channelId,
      channelTitle: connection.channelTitle,
      displayName: connection.displayName,
      connectedAt: connection.connectedAt,
      lastUsedAt: connection.lastUsedAt,
      status: connection.status,
    }
  },
})

// ─── Internal Mutations ─────────────────────────────────────────────────────

export const storeConnection = internalMutation({
  args: {
    userId: v.id("users"),
    platform: platformValidator,
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiresAt: v.number(),
    channelId: v.string(),
    channelTitle: v.string(),
    displayName: v.string(),
    connectedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
  },
  handler: async (ctx, args) => {
    // Remove any existing connection for this user + platform
    const existing = await ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) =>
        q.eq("userId", args.userId).eq("platform", args.platform),
      )
      .first()
    if (existing) {
      await ctx.db.delete(existing._id)
    }

    return ctx.db.insert("connectedPlatforms", args)
  },
})

export const updateTokens = internalMutation({
  args: {
    connectionId: v.id("connectedPlatforms"),
    accessToken: v.string(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, { connectionId, accessToken, tokenExpiresAt }) => {
    await ctx.db.patch(connectionId, { accessToken, tokenExpiresAt, status: "active" })
  },
})

export const markExpired = internalMutation({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.patch(connectionId, { status: "expired" })
  },
})

export const removeConnection = internalMutation({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.delete(connectionId)
  },
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run convex/__tests__/connected-platforms.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add convex/connected-platforms.ts convex/__tests__/connected-platforms.test.ts
git commit -m "feat: add connected-platforms queries and internal mutations"
```

---

### Task 4: Convex actions — YouTube OAuth exchange, refresh, disconnect

**Files:**
- Create: `convex/connected-platforms-actions.ts`
- Modify: `convex/connected-platforms.ts` (add `getUserByPrivyDid` and `getRawConnection` internal queries)

The queries and mutations in `convex/connected-platforms.ts` run in Convex's fast V8 runtime. The actions need Node.js `crypto` for encryption, so they live in a separate file with `"use node"`. This split is the standard Convex pattern — keep queries fast, isolate Node dependencies.

These actions call external Google APIs and cannot be tested with `convex-test`. They will be verified via manual E2E testing after the API routes and UI are wired up.

- [ ] **Step 1: Add the `generateYoutubeAuthUrl` action**

Create `convex/connected-platforms-actions.ts`:

```ts
"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { internal } from "./_generated/api"
import { encrypt, decrypt, signState } from "./lib/token-encryption"

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
```

- [ ] **Step 2: Add the `exchangeYoutubeCode` action**

Add below `generateYoutubeAuthUrl`:

```ts
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
```

- [ ] **Step 3: Add the `getUserByPrivyDid` internal query**

Add to `convex/connected-platforms.ts` (after the `removeConnection` mutation):

```ts
export const getUserByPrivyDid = internalQuery({
  args: { privyDid: v.string() },
  handler: async (ctx, { privyDid }) => {
    return ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", privyDid))
      .unique()
  },
})
```

- [ ] **Step 4: Add the `refreshYoutubeToken` action**

Add below `exchangeYoutubeCode` in `convex/connected-platforms-actions.ts`:

```ts
export const refreshYoutubeToken = action({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error("YouTube OAuth not configured")
    }

    // Read the connection record (need raw data with encrypted tokens)
    const connection = await ctx.runQuery(
      internal.connectedPlatforms.getRawConnection,
      { connectionId },
    )
    if (!connection || !connection.refreshToken) {
      throw new Error("No refresh token available")
    }

    // Check if token is still fresh (more than 5 minutes remaining)
    if (connection.tokenExpiresAt && connection.tokenExpiresAt > Date.now() + 5 * 60_000) {
      return // Token is still valid
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
      // Token was revoked by user on Google's side
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
```

- [ ] **Step 5: Add the `getRawConnection` internal query**

Add to `convex/connected-platforms.ts`:

```ts
export const getRawConnection = internalQuery({
  args: { connectionId: v.id("connectedPlatforms") },
  handler: async (ctx, { connectionId }) => {
    return ctx.db.get(connectionId)
  },
})
```

- [ ] **Step 6: Add the `disconnectPlatform` action**

Add below `refreshYoutubeToken` in `convex/connected-platforms-actions.ts`:

```ts
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
```

- [ ] **Step 7: Add the `getRawConnectionByUserAndPlatform` internal query**

Add to `convex/connected-platforms.ts`:

```ts
export const getRawConnectionByUserAndPlatform = internalQuery({
  args: {
    userId: v.id("users"),
    platform: platformValidator,
  },
  handler: async (ctx, { userId, platform }) => {
    return ctx.db
      .query("connectedPlatforms")
      .withIndex("by_user_and_platform", (q) =>
        q.eq("userId", userId).eq("platform", platform),
      )
      .first()
  },
})
```

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add convex/connected-platforms.ts convex/connected-platforms-actions.ts
git commit -m "feat: add YouTube OAuth actions — exchange, refresh, disconnect"
```

---

### Task 5: Next.js API routes — OAuth initiation and callback

**Files:**
- Create: `app/api/auth/youtube/route.ts`
- Create: `app/api/auth/youtube/callback/route.ts`

- [ ] **Step 1: Create the OAuth initiation route**

Create `app/api/auth/youtube/route.ts`:

```ts
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
    privyDid = verified.userId
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
```

- [ ] **Step 2: Create the OAuth callback route**

Create `app/api/auth/youtube/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import { verifyState } from "@/convex/lib/token-encryption"

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
  const payload = state.slice(0, lastColon)  // "privyDid:timestamp"

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
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/youtube/route.ts app/api/auth/youtube/callback/route.ts
git commit -m "feat: add Next.js API routes for YouTube OAuth flow"
```

---

### Task 6: UI — Connected Platforms section in stream settings

**Files:**
- Modify: `app/dashboard/settings/stream/page.tsx`

- [ ] **Step 1: Add the Connected Platforms section**

Replace the full content of `app/dashboard/settings/stream/page.tsx` with:

```tsx
"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation, useAction } from "convex/react"
import { useSearchParams } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { CATEGORIES, type StreamCategory } from "@/convex/schema"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Check, Youtube, Unplug } from "lucide-react"

export default function StreamSettingsPage() {
  const user = useQuery(api.users.getCurrentUser, {})
  const updateStreamPreferences = useMutation(api.users.updateStreamPreferences)
  const connectedPlatforms = useQuery(api.connectedPlatforms.getConnectedPlatforms, {})
  const disconnectPlatform = useAction(api.connectedPlatformsActions.disconnectPlatform)

  const [category, setCategory] = useState<StreamCategory | null>(null)
  const [slowMode, setSlowMode] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [disconnectConfirm, setDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Read YouTube OAuth result from URL params
  const searchParams = useSearchParams()
  const youtubeResult = searchParams.get("youtube")
  const [youtubeMessage, setYoutubeMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  useEffect(() => {
    if (youtubeResult === "connected") {
      setYoutubeMessage({ type: "success", text: "YouTube channel connected successfully!" })
    } else if (youtubeResult === "error") {
      const reason = searchParams.get("reason") ?? "unknown"
      setYoutubeMessage({ type: "error", text: `Failed to connect YouTube: ${reason}` })
    }
  }, [youtubeResult, searchParams])

  // Derive displayed values: local state overrides user record
  const displayCategory = category ?? user?.defaultCategory ?? "Other"
  const displaySlowMode = slowMode ?? String(user?.defaultSlowModeInterval ?? 0)

  const youtubeConnection = connectedPlatforms?.find((p) => p.platform === "youtube")

  if (user === undefined) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  if (user === null) {
    return (
      <p className="text-sm text-muted-foreground">
        You must be signed in to access stream settings.
      </p>
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const interval = Number(displaySlowMode)
      if (isNaN(interval) || interval < 0) {
        throw new Error("Slow mode interval must be a non-negative number")
      }

      await updateStreamPreferences({
        defaultCategory: displayCategory as StreamCategory,
        defaultSlowModeInterval: interval,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnectYouTube() {
    setDisconnecting(true)
    try {
      await disconnectPlatform({ platform: "youtube" })
      setDisconnectConfirm(false)
      setYoutubeMessage({ type: "success", text: "YouTube channel disconnected." })
    } catch (err) {
      setYoutubeMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to disconnect",
      })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stream Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage connected platforms and configure your default stream settings.
        </p>
      </div>

      {/* ── Connected Platforms ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label>Connected Platforms</Label>

        {youtubeMessage && (
          <p
            className={`text-sm ${youtubeMessage.type === "success" ? "text-green-400" : "text-red-400"}`}
          >
            {youtubeMessage.text}
          </p>
        )}

        <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <Youtube className="size-5 text-red-500" />
            {youtubeConnection ? (
              <div>
                <p className="text-sm font-medium text-foreground">
                  {youtubeConnection.channelTitle ?? "YouTube"}
                </p>
                <span className="text-xs text-green-400">Active</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">YouTube</p>
            )}
          </div>

          {youtubeConnection ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDisconnectConfirm(true)}
              className="text-zinc-400 hover:text-red-400"
            >
              <Unplug className="mr-1.5 size-3.5" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = "/api/auth/youtube"
              }}
            >
              Connect
            </Button>
          )}
        </div>
      </div>

      {/* ── Stream Preferences ──────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="category">Default Category</Label>
          <Select
            value={displayCategory}
            onValueChange={(val) => setCategory(val as StreamCategory)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slowMode">Slow Mode Interval (seconds)</Label>
          <Input
            id="slowMode"
            type="number"
            min={0}
            value={displaySlowMode}
            onChange={(e) => setSlowMode(e.target.value)}
            placeholder="0"
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Set to 0 to disable slow mode. When enabled, viewers must wait this many seconds between
            chat messages.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving...
          </>
        ) : saved ? (
          <>
            <Check className="size-4" />
            Saved
          </>
        ) : (
          "Save Preferences"
        )}
      </Button>

      {/* ── Disconnect Confirmation Dialog ──────────────────────────────── */}
      <Dialog open={disconnectConfirm} onOpenChange={setDisconnectConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect YouTube?</DialogTitle>
            <DialogDescription>
              This will revoke Switched&apos;s access to your YouTube channel. You can reconnect at any
              time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDisconnectConfirm(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDisconnectYouTube()}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/settings/stream/page.tsx
git commit -m "feat: add Connected Platforms UI to stream settings page"
```

---

### Task 7: UI — Destinations section in go-live modal

**Files:**
- Modify: `components/studio/go-live-modal.tsx`

- [ ] **Step 1: Add the query import and destinations state**

In `components/studio/go-live-modal.tsx`, add the following import at the top alongside existing imports:

```ts
import { Youtube } from "lucide-react"
```

Add `Switch` import:

```ts
import { Switch } from "@/components/ui/switch"
```

Add the connected platforms query inside the `GoLiveModal` component, alongside the existing `useQuery` calls:

```ts
const connectedPlatforms = useQuery(api.connectedPlatforms.getConnectedPlatforms, {})
```

Add state for the YouTube destination toggle:

```ts
const [youtubeEnabled, setYoutubeEnabled] = useState(true)
```

Derive the YouTube connection:

```ts
const youtubeConnection = connectedPlatforms?.find(
  (p) => p.platform === "youtube" && p.status === "active",
)
```

- [ ] **Step 2: Add the Destinations section to the modal JSX**

Add the following JSX block after the billing `</div>` (the `mb-6 rounded-xl` div that ends around line 221) and before the `{/* Actions */}` comment:

```tsx
        {/* Destinations */}
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Destinations
          </p>
          <div className="space-y-2">
            {/* Switched — always on */}
            <div className="flex items-center justify-between rounded-lg bg-zinc-800/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-red-500" />
                <span className="text-sm text-zinc-300">Switched</span>
              </div>
              <span className="text-xs text-zinc-500">Always on</span>
            </div>

            {/* YouTube — toggle if connected */}
            {youtubeConnection && (
              <div className="flex items-center justify-between rounded-lg bg-zinc-800/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Youtube className="size-4 text-red-500" />
                  <span className="text-sm text-zinc-300">
                    {youtubeConnection.channelTitle ?? "YouTube"}
                  </span>
                </div>
                <Switch
                  checked={youtubeEnabled}
                  onCheckedChange={setYoutubeEnabled}
                  disabled={isStarting}
                />
              </div>
            )}

            {/* No platforms connected */}
            {(!connectedPlatforms || connectedPlatforms.length === 0) && (
              <a
                href="/dashboard/settings/stream"
                className="block text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Connect platforms in Settings →
              </a>
            )}
          </div>
        </div>
```

- [ ] **Step 3: Update the `onConfirm` type and call to include destinations**

Update the `GoLiveModalProps` type to include destinations:

```ts
type GoLiveModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (
    title: string,
    category: StreamCategory,
    sessionPlan: StreamSessionPlan,
    destinations: { youtube: boolean },
  ) => Promise<void>
  isStarting: boolean
}
```

Update `handleConfirm` to pass destinations:

```ts
  async function handleConfirm() {
    if (!canSubmit || category === null) return
    await onConfirm(
      title.trim(),
      category,
      {
        plannedMinutes: 60,
        allowExtraUsageSpending: true,
        overtimeMinutes: 0,
      },
      { youtube: !!youtubeConnection && youtubeEnabled },
    )
  }
```

- [ ] **Step 4: Update the caller of GoLiveModal to accept the new `destinations` parameter**

Find where `GoLiveModal` is rendered and its `onConfirm` is defined. The `destinations` parameter can be accepted and ignored for now — the actual simulcast logic is out of scope. Add `_destinations` to the callback signature:

Search for usage of `GoLiveModal` and update the `onConfirm` handler to accept the fourth parameter:

```ts
onConfirm={async (title, category, sessionPlan, _destinations) => {
```

This ensures TypeScript is happy. The `_destinations` parameter will be used in a follow-up issue when RTMP simulcast is implemented.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add components/studio/go-live-modal.tsx
git commit -m "feat: add Destinations section to go-live modal with YouTube toggle"
```

---

### Task 8: Verify and fix — full typecheck and test suite

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass, including the new `token-encryption` and `connected-platforms` tests.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No lint errors. Fix any that appear.

- [ ] **Step 4: Manual smoke test checklist**

These require Google Cloud OAuth credentials to be configured. Add to `.env.local`:
```
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback
TOKEN_ENCRYPTION_KEY=<output-of-openssl-rand-hex-32>
```

Start the dev server: `pnpm dev`

Then verify:
1. Navigate to `/dashboard/settings/stream` — the "Connected Platforms" section shows YouTube with a "Connect" button
2. Click "Connect" — redirects to Google OAuth consent screen
3. After consenting — redirects back to `/dashboard/settings/stream?youtube=connected` with a success message
4. The YouTube card now shows the channel name and an "Active" badge
5. Click "Disconnect" — confirmation dialog appears
6. Confirm disconnect — YouTube card returns to "Connect" state
7. Open the studio and click "Go Live" — the modal shows a "Destinations" section with "Switched (Always on)" and "YouTube" with a toggle (if connected)
8. If no YouTube is connected, the modal shows "Connect platforms in Settings →" link

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address lint and typecheck issues from YouTube OAuth integration"
```
