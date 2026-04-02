"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { api, internal } from "./_generated/api"
import {
  prepareTipTransaction,
  submitTipTransaction,
} from "../lib/solana/server-platform-wallet"

export const prepareSendTip = action({
  args: {
    streamId: v.id("streams"),
    amount: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { streamId, amount },
  ): Promise<Awaited<ReturnType<typeof prepareTipTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = (await ctx.runQuery(api.users.getCurrentUser, {})) as
      | { _id: string; walletAddress?: string }
      | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    const tipTarget = await ctx.runQuery(internal.tips.getTipTarget, { streamId })
    if (tipTarget.creatorId === userRecord._id) {
      throw new Error("Cannot tip yourself")
    }

    return prepareTipTransaction(
      userRecord.walletAddress,
      tipTarget.creatorWalletAddress,
      amount,
      "tips:send",
    )
  },
})

export const submitSendTip = action({
  args: {
    streamId: v.id("streams"),
    amount: v.number(),
    message: v.optional(v.string()),
    signedTransactionBase64: v.string(),
  },
  handler: async (
    ctx,
    { streamId, amount, message, signedTransactionBase64 },
  ): Promise<Awaited<ReturnType<typeof submitTipTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = (await ctx.runQuery(api.users.getCurrentUser, {})) as
      | { _id: string; username?: string; walletAddress?: string }
      | null
    if (!userRecord?.walletAddress || !userRecord.username) {
      throw new Error("Wallet setup incomplete")
    }

    const tipTarget = await ctx.runQuery(internal.tips.getTipTarget, { streamId })
    if (tipTarget.creatorId === userRecord._id) {
      throw new Error("Cannot tip yourself")
    }

    const result = await submitTipTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "tips:send",
    )

    await ctx.runMutation(internal.tips.recordBroadcastTip, {
      fromUserId: userRecord._id as never,
      toUserId: tipTarget.creatorId,
      streamId,
      fromUsername: userRecord.username,
      amount,
      message,
      solanaSignature: result.signature,
      tokenMint: result.tokenMint,
    })

    return result
  },
})
