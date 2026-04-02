"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import {
  preparePlatformWalletCreationTransaction,
  submitPlatformWalletCreationTransaction,
} from "../lib/solana/server-platform-wallet"

export const prepareEnsurePlatformWallet = action({
  args: {},
  handler: async (ctx): Promise<Awaited<ReturnType<typeof preparePlatformWalletCreationTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return preparePlatformWalletCreationTransaction(
      userRecord.walletAddress,
      "streams:goLive",
    )
  },
})

export const submitEnsurePlatformWallet = action({
  args: {
    signedTransactionBase64: v.string(),
  },
  handler: async (
    ctx,
    { signedTransactionBase64 },
  ): Promise<Awaited<ReturnType<typeof submitPlatformWalletCreationTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return submitPlatformWalletCreationTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "streams:goLive",
    )
  },
})
