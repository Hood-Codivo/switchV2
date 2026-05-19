import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedUser } from "./auth";
import { infrastructureStreamStatusValidator } from "./schema";

const TOKENS_PER_LIVE_MINUTE = 1;
const DEFAULT_TOP_UP_PACKS = [500, 2500, 10000] as const;

type InfrastructureStreamStatus = Doc<"infrastructureStreams">["status"];
type StreamPatch = {
  status?: InfrastructureStreamStatus;
  playbackUrl?: string;
  startedAt?: number;
  endedAt?: number;
  tokenCost?: number;
};

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `org-${crypto.randomUUID().slice(0, 8)}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createRawApiKey() {
  return `sk_test_switched_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function createIntegrationToken(role: "host" | "guest" | "viewer") {
  return `sw_${role}_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function publicStreamPayload(stream: Doc<"infrastructureStreams">) {
  return {
    id: stream._id,
    title: stream.title,
    externalStreamId: stream.externalStreamId ?? null,
    externalUserId: stream.externalUserId ?? null,
    status: stream.status,
    playbackUrl: stream.playbackUrl ?? null,
    studioPath: stream.studioPath,
    embedPath: stream.embedPath,
    tokenCost: stream.tokenCost,
    createdAt: stream.createdAt,
    startedAt: stream.startedAt ?? null,
    endedAt: stream.endedAt ?? null,
  };
}

async function getOwnedOrganization(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthenticatedUser(ctx);
  return ctx.db
    .query("infrastructureOrganizations")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .first();
}

export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    let organization;
    try {
      organization = await getOwnedOrganization(ctx);
    } catch {
      return null;
    }

    if (!organization) {
      return {
        organization: null,
        apiKeys: [],
        streams: [],
        transactions: [],
        topUpPacks: [...DEFAULT_TOP_UP_PACKS],
      };
    }

    const [apiKeys, streams, transactions] = await Promise.all([
      ctx.db
        .query("infrastructureApiKeys")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("infrastructureStreams")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("infrastructureTokenTransactions")
        .withIndex("by_organization_and_created", (q) =>
          q.eq("organizationId", organization._id),
        )
        .order("desc")
        .take(20),
    ]);

    return {
      organization,
      apiKeys,
      streams: streams.map(publicStreamPayload),
      transactions,
      topUpPacks: [...DEFAULT_TOP_UP_PACKS],
    };
  },
});

export const createOrganization = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const ownerId = await getAuthenticatedUser(ctx);
    const existing = await ctx.db
      .query("infrastructureOrganizations")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .first();
    if (existing) return existing._id;

    const trimmedName = name.trim().slice(0, 80) || "My platform";
    const now = Date.now();
    return ctx.db.insert("infrastructureOrganizations", {
      ownerId,
      name: trimmedName,
      slug: `${slugify(trimmedName)}-${crypto.randomUUID().slice(0, 6)}`,
      tokenBalance: 100,
      totalPurchased: 100,
      totalConsumed: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const purchaseTokens = mutation({
  args: { amount: v.number() },
  handler: async (ctx, { amount }) => {
    const organization = await getOwnedOrganization(ctx);
    if (!organization)
      throw new Error("Create an infrastructure organization first");
    if (
      !DEFAULT_TOP_UP_PACKS.includes(
        amount as (typeof DEFAULT_TOP_UP_PACKS)[number],
      )
    ) {
      throw new Error("Invalid token pack");
    }

    const balanceAfter = organization.tokenBalance + amount;
    await ctx.db.patch(organization._id, {
      tokenBalance: balanceAfter,
      totalPurchased: organization.totalPurchased + amount,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("infrastructureTokenTransactions", {
      organizationId: organization._id,
      type: "purchase",
      amount,
      balanceAfter,
      description: `${amount.toLocaleString()} infrastructure tokens purchased`,
      reference: `top_up_${crypto.randomUUID()}`,
      createdAt: Date.now(),
    });
  },
});

export const createApiKey = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const organization = await getOwnedOrganization(ctx);
    if (!organization)
      throw new Error("Create an infrastructure organization first");

    const rawKey = createRawApiKey();
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 24);
    const now = Date.now();
    const id = await ctx.db.insert("infrastructureApiKeys", {
      organizationId: organization._id,
      name: name.trim().slice(0, 60) || "Default key",
      keyHash,
      keyPrefix,
      createdAt: now,
    });

    return { id, key: rawKey, keyPrefix };
  },
});

export const revokeApiKey = mutation({
  args: { id: v.id("infrastructureApiKeys") },
  handler: async (ctx, { id }) => {
    const organization = await getOwnedOrganization(ctx);
    if (!organization)
      throw new Error("Create an infrastructure organization first");
    const key = await ctx.db.get(id);
    if (!key || key.organizationId !== organization._id)
      throw new Error("API key not found");
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

export const getEmbedStream = query({
  args: { streamId: v.id("infrastructureStreams") },
  handler: async (ctx, { streamId }) => {
    const stream = await ctx.db.get(streamId);
    if (!stream) return null;
    const organization = await ctx.db.get(stream.organizationId);
    if (!organization) return null;
    return {
      stream: publicStreamPayload(stream),
      organization: {
        name: organization.name,
        slug: organization.slug,
      },
    };
  },
});

export const getStreamByAccessToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const hostStream = await ctx.db
      .query("infrastructureStreams")
      .withIndex("by_host_token", (q) => q.eq("hostToken", token))
      .first();
    const stream =
      hostStream ??
      (await ctx.db
        .query("infrastructureStreams")
        .withIndex("by_viewer_token", (q) => q.eq("viewerToken", token))
        .first());
    if (!stream) return null;

    const organization = await ctx.db.get(stream.organizationId);
    if (!organization) return null;

    return {
      stream: publicStreamPayload(stream),
      organization: {
        name: organization.name,
        slug: organization.slug,
        tokenBalance: organization.tokenBalance,
      },
      role: hostStream ? ("host" as const) : ("viewer" as const),
    };
  },
});

export const updateStreamStatusByHostToken = mutation({
  args: {
    streamId: v.id("infrastructureStreams"),
    hostToken: v.string(),
    status: v.union(v.literal("live"), v.literal("ended")),
    playbackUrl: v.optional(v.string()),
  },
  handler: async (ctx, { streamId, hostToken, status, playbackUrl }) => {
    const stream = await ctx.db.get(streamId);
    if (!stream || stream.hostToken !== hostToken)
      throw new Error("Invalid host token");
    const organization = await ctx.db.get(stream.organizationId);
    if (!organization) throw new Error("Organization not found");

    const now = Date.now();
    const patch: StreamPatch = { status };
    if (status === "live") {
      if (organization.tokenBalance <= 0)
        throw new Error("Token balance exhausted");
      patch.startedAt = stream.startedAt ?? now;
      patch.playbackUrl = playbackUrl;
    } else {
      const startedAt = stream.startedAt ?? now;
      const elapsedMinutes = Math.max(1, Math.ceil((now - startedAt) / 60_000));
      const cost = elapsedMinutes * TOKENS_PER_LIVE_MINUTE;
      const debit = Math.min(organization.tokenBalance, cost);
      const exhausted = debit < cost;
      const balanceAfter = organization.tokenBalance - debit;

      patch.endedAt = now;
      patch.status = exhausted ? "exhausted" : "ended";
      patch.tokenCost = stream.tokenCost + debit;

      await ctx.db.patch(organization._id, {
        tokenBalance: balanceAfter,
        totalConsumed: organization.totalConsumed + debit,
        updatedAt: now,
      });
      await ctx.db.insert("infrastructureTokenTransactions", {
        organizationId: organization._id,
        type: "debit",
        amount: -debit,
        balanceAfter,
        description: `${stream.title} used ${debit.toLocaleString()} infrastructure tokens`,
        reference: stream._id,
        createdAt: now,
      });
    }

    await ctx.db.patch(streamId, patch);
    const updated = await ctx.db.get(streamId);
    if (!updated) throw new Error("Stream not found");
    return publicStreamPayload(updated);
  },
});

export const createStreamFromApiKey = mutation({
  args: {
    keyHash: v.string(),
    title: v.string(),
    externalStreamId: v.optional(v.string()),
    externalUserId: v.optional(v.string()),
    origin: v.string(),
  },
  handler: async (
    ctx,
    { keyHash, title, externalStreamId, externalUserId, origin },
  ) => {
    const key = await ctx.db
      .query("infrastructureApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (!key || key.revokedAt) throw new Error("Invalid API key");

    const organization = await ctx.db.get(key.organizationId);
    if (!organization || organization.status !== "active")
      throw new Error("Organization is not active");
    if (organization.tokenBalance <= 0)
      throw new Error("Token balance exhausted");

    const now = Date.now();
    const hostToken = createIntegrationToken("host");
    const viewerToken = createIntegrationToken("viewer");
    const streamId = await ctx.db.insert("infrastructureStreams", {
      organizationId: organization._id,
      title: title.trim().slice(0, 120) || "Untitled stream",
      externalStreamId: externalStreamId?.trim().slice(0, 120),
      externalUserId: externalUserId?.trim().slice(0, 120),
      status: "created",
      studioPath: "",
      embedPath: "",
      hostToken,
      viewerToken,
      tokenCost: 0,
      createdAt: now,
    });

    const studioPath = `/infrastructure/studio/${streamId}?token=${hostToken}`;
    const embedPath = `/infrastructure/embed/${streamId}?token=${viewerToken}`;
    await ctx.db.patch(streamId, { studioPath, embedPath });
    await ctx.db.patch(key._id, { lastUsedAt: now });

    const stream = await ctx.db.get(streamId);
    if (!stream) throw new Error("Stream creation failed");

    return {
      ...publicStreamPayload(stream),
      studioUrl: `${origin}${studioPath}`,
      viewerEmbedUrl: `${origin}${embedPath}`,
      hostToken,
      viewerToken,
      tokenBalance: organization.tokenBalance,
    };
  },
});

export const listStreamsForApiKey = query({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const key = await ctx.db
      .query("infrastructureApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (!key || key.revokedAt) throw new Error("Invalid API key");

    const streams = await ctx.db
      .query("infrastructureStreams")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", key.organizationId),
      )
      .order("desc")
      .take(50);

    return streams.map(publicStreamPayload);
  },
});

export const getStreamForApiKey = query({
  args: { keyHash: v.string(), streamId: v.id("infrastructureStreams") },
  handler: async (ctx, { keyHash, streamId }) => {
    const key = await ctx.db
      .query("infrastructureApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (!key || key.revokedAt) throw new Error("Invalid API key");
    const stream = await ctx.db.get(streamId);
    if (!stream || stream.organizationId !== key.organizationId)
      throw new Error("Stream not found");
    return publicStreamPayload(stream);
  },
});

export const updateStreamStatusFromApiKey = mutation({
  args: {
    keyHash: v.string(),
    streamId: v.id("infrastructureStreams"),
    status: infrastructureStreamStatusValidator,
    playbackUrl: v.optional(v.string()),
  },
  handler: async (ctx, { keyHash, streamId, status, playbackUrl }) => {
    const key = await ctx.db
      .query("infrastructureApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (!key || key.revokedAt) throw new Error("Invalid API key");

    const stream = await ctx.db.get(streamId);
    if (!stream || stream.organizationId !== key.organizationId)
      throw new Error("Stream not found");
    const organization = await ctx.db.get(key.organizationId);
    if (!organization) throw new Error("Organization not found");

    const now = Date.now();
    const patch: StreamPatch = { status };

    if (status === "live") {
      if (organization.tokenBalance <= 0)
        throw new Error("Token balance exhausted");
      patch.startedAt = stream.startedAt ?? now;
      patch.playbackUrl = playbackUrl;
    }

    if (status === "ended" || status === "exhausted") {
      const startedAt = stream.startedAt ?? now;
      const elapsedMinutes = Math.max(1, Math.ceil((now - startedAt) / 60_000));
      const cost = elapsedMinutes * TOKENS_PER_LIVE_MINUTE;
      const debit = Math.min(organization.tokenBalance, cost);
      const exhausted = debit < cost;
      const balanceAfter = organization.tokenBalance - debit;

      patch.endedAt = now;
      patch.status = exhausted ? "exhausted" : status;
      patch.tokenCost = stream.tokenCost + debit;

      await ctx.db.patch(organization._id, {
        tokenBalance: balanceAfter,
        totalConsumed: organization.totalConsumed + debit,
        updatedAt: now,
      });
      await ctx.db.insert("infrastructureTokenTransactions", {
        organizationId: organization._id,
        type: "debit",
        amount: -debit,
        balanceAfter,
        description: `${stream.title} used ${debit.toLocaleString()} infrastructure tokens`,
        reference: stream._id,
        createdAt: now,
      });
    }

    await ctx.db.patch(streamId, patch);
    const updated = await ctx.db.get(streamId);
    if (!updated) throw new Error("Stream not found");
    return publicStreamPayload(updated);
  },
});

export const issueIntegrationTokenFromApiKey = mutation({
  args: {
    keyHash: v.string(),
    streamId: v.id("infrastructureStreams"),
    role: v.union(v.literal("host"), v.literal("guest"), v.literal("viewer")),
    expiresInSeconds: v.optional(v.number()),
  },
  handler: async (ctx, { keyHash, streamId, role, expiresInSeconds }) => {
    const key = await ctx.db
      .query("infrastructureApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (!key || key.revokedAt) throw new Error("Invalid API key");
    const stream = await ctx.db.get(streamId);
    if (!stream || stream.organizationId !== key.organizationId)
      throw new Error("Stream not found");

    const ttl = Math.min(Math.max(expiresInSeconds ?? 3600, 300), 86_400);
    const now = Date.now();
    const token = createIntegrationToken(role);
    await ctx.db.insert("infrastructureIntegrationTokens", {
      organizationId: key.organizationId,
      streamId,
      role,
      token,
      expiresAt: now + ttl * 1000,
      createdAt: now,
    });

    return { token, role, expiresAt: now + ttl * 1000 };
  },
});
