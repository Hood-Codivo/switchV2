/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 */

import type * as auth from "../auth.js"
import type * as backstageChat from "../backstageChat.js"
import type * as chat from "../chat.js"
import type * as cloudflareStream from "../cloudflareStream.js"
import type * as connectedPlatforms from "../connectedPlatforms.js"
import type * as connectedPlatformsActions from "../connectedPlatformsActions.js"
import type * as creatorLiveInputs from "../creatorLiveInputs.js"
import type * as crons from "../crons.js"
import type * as dashboard from "../dashboard.js"
import type * as follows from "../follows.js"
import type * as http from "../http.js"
import type * as notifications from "../notifications.js"
import type * as rtkRecordings from "../rtkRecordings.js"
import type * as serverPlatformWallet from "../serverPlatformWallet.js"
import type * as serverTips from "../serverTips.js"
import type * as streamBroadcasts from "../streamBroadcasts.js"
import type * as streams from "../streams.js"
import type * as streamViewers from "../streamViewers.js"
import type * as studio from "../studio.js"
import type * as tips from "../tips.js"
import type * as users from "../users.js"
import type * as webhooks from "../webhooks.js"
import type * as youtubeBroadcasts from "../youtubeBroadcasts.js"
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server"
import { anyApi } from "convex/server"

const fullApi: ApiFromModules<{
  auth: typeof auth
  backstageChat: typeof backstageChat
  chat: typeof chat
  cloudflareStream: typeof cloudflareStream
  connectedPlatforms: typeof connectedPlatforms
  connectedPlatformsActions: typeof connectedPlatformsActions
  creatorLiveInputs: typeof creatorLiveInputs
  crons: typeof crons
  dashboard: typeof dashboard
  follows: typeof follows
  http: typeof http
  notifications: typeof notifications
  rtkRecordings: typeof rtkRecordings
  serverPlatformWallet: typeof serverPlatformWallet
  serverTips: typeof serverTips
  streamBroadcasts: typeof streamBroadcasts
  streams: typeof streams
  streamViewers: typeof streamViewers
  studio: typeof studio
  tips: typeof tips
  users: typeof users
  webhooks: typeof webhooks
  youtubeBroadcasts: typeof youtubeBroadcasts
}> = anyApi as any

export const api: FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "public">
> = anyApi as any

export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "internal">
> = anyApi as any
