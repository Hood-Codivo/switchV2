/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as backstageChat from "../backstageChat.js";
import type * as chat from "../chat.js";
import type * as cloudflareStream from "../cloudflareStream.js";
import type * as connectedPlatforms from "../connectedPlatforms.js";
import type * as connectedPlatformsActions from "../connectedPlatformsActions.js";
import type * as creatorLiveInputs from "../creatorLiveInputs.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as follows from "../follows.js";
import type * as http from "../http.js";
import type * as infrastructure from "../infrastructure.js";
import type * as lib_tokenEncryption from "../lib/tokenEncryption.js";
import type * as lib_username from "../lib/username.js";
import type * as notifications from "../notifications.js";
import type * as rtkRecordings from "../rtkRecordings.js";
import type * as serverPlatformWallet from "../serverPlatformWallet.js";
import type * as serverTips from "../serverTips.js";
import type * as streamBroadcasts from "../streamBroadcasts.js";
import type * as streamViewers from "../streamViewers.js";
import type * as streams from "../streams.js";
import type * as studio from "../studio.js";
import type * as tips from "../tips.js";
import type * as users from "../users.js";
import type * as webhooks from "../webhooks.js";
import type * as youtubeBroadcasts from "../youtubeBroadcasts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  backstageChat: typeof backstageChat;
  chat: typeof chat;
  cloudflareStream: typeof cloudflareStream;
  connectedPlatforms: typeof connectedPlatforms;
  connectedPlatformsActions: typeof connectedPlatformsActions;
  creatorLiveInputs: typeof creatorLiveInputs;
  crons: typeof crons;
  dashboard: typeof dashboard;
  follows: typeof follows;
  http: typeof http;
  infrastructure: typeof infrastructure;
  "lib/tokenEncryption": typeof lib_tokenEncryption;
  "lib/username": typeof lib_username;
  notifications: typeof notifications;
  rtkRecordings: typeof rtkRecordings;
  serverPlatformWallet: typeof serverPlatformWallet;
  serverTips: typeof serverTips;
  streamBroadcasts: typeof streamBroadcasts;
  streamViewers: typeof streamViewers;
  streams: typeof streams;
  studio: typeof studio;
  tips: typeof tips;
  users: typeof users;
  webhooks: typeof webhooks;
  youtubeBroadcasts: typeof youtubeBroadcasts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
