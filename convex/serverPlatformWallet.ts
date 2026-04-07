"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  prepareBuySwtdMeteoraSwapTransaction,
  prepareBuySwtdSwapTransaction,
  preparePrepaidSwtdChargeTransaction,
  preparePlatformWalletCreationTransaction,
  prepareWithdrawalTransaction,
  quoteBuySwtdTransaction,
  submitBuySwtdSwapTransaction,
  submitPrepaidSwtdChargeTransaction,
  submitPlatformWalletCreationTransaction,
  submitWithdrawalTransaction,
} from "../lib/solana/server-platform-wallet"
import type { WithdrawToken } from "../lib/solana/tokens"

const STREAM_RATE_PER_HOUR_USD = 0.5
const SWTD_USD_PRICE = 0.00000536288

const streamSessionPlanValidator = v.object({
  plannedMinutes: v.number(),
  allowExtraUsageSpending: v.boolean(),
  overtimeMinutes: v.number(),
})

function normalizeSessionPlan(
  sessionPlan?: {
    plannedMinutes: number
    allowExtraUsageSpending: boolean
    overtimeMinutes: number
  } | null,
) {
  const plannedMinutes = sessionPlan?.plannedMinutes ?? 60
  const allowExtraUsageSpending = sessionPlan?.allowExtraUsageSpending ?? false
  const overtimeMinutes = allowExtraUsageSpending ? (sessionPlan?.overtimeMinutes ?? 30) : 0
  const prepaidUsd = (plannedMinutes / 60) * STREAM_RATE_PER_HOUR_USD

  return {
    plannedMinutes,
    allowExtraUsageSpending,
    overtimeMinutes,
    prepaidUsd,
    prepaidSwtdAmount: (prepaidUsd / SWTD_USD_PRICE).toString(),
  }
}

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

export const preparePrepaidSwtdCharge = action({
  args: {
    sessionPlan: v.optional(streamSessionPlanValidator),
  },
  handler: async (
    ctx,
    { sessionPlan },
  ): Promise<Awaited<ReturnType<typeof preparePrepaidSwtdChargeTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      _id: Id<"users">
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    const activeSession = await ctx.runQuery(internal.streams.getActiveSessionForCreator, {
      userId: userRecord._id,
    })
    if (activeSession?.prepaidChargedAt) {
      const billing = normalizeSessionPlan(sessionPlan)
      return {
        tokenMint: "mLpmTV7yBWUysSw9pQaqRqfhwcaYizSPVfPaRGycyai",
        senderWalletAddress: userRecord.walletAddress,
        destinationWalletAddress: userRecord.walletAddress,
        destinationAta: userRecord.walletAddress,
        amount: Number(billing.prepaidSwtdAmount),
        transactionBase64: "",
      } as Awaited<ReturnType<typeof preparePrepaidSwtdChargeTransaction>>
    }

    const billing = normalizeSessionPlan(sessionPlan)
    return preparePrepaidSwtdChargeTransaction(
      userRecord.walletAddress,
      billing.prepaidSwtdAmount,
      "streams:prepaid",
    )
  },
})

export const submitPrepaidSwtdCharge = action({
  args: {
    signedTransactionBase64: v.string(),
  },
  handler: async (
    ctx,
    { signedTransactionBase64 },
  ): Promise<Awaited<ReturnType<typeof submitPrepaidSwtdChargeTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      _id: Id<"users">
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    const result = await submitPrepaidSwtdChargeTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "streams:prepaid",
    )

    const activeSession = await ctx.runQuery(internal.streams.getActiveSessionForCreator, {
      userId: userRecord._id,
    })
    if (activeSession) {
      await ctx.runMutation(internal.streams.markPrepaidChargeOnSession, {
        sessionId: activeSession._id,
        signature: result.signature,
        chargedAt: Date.now(),
      })
    }

    return result
  },
})

export const prepareStreamTopUpCharge = action({
  args: {
    purchasedMinutes: v.number(),
  },
  handler: async (
    ctx,
    { purchasedMinutes },
  ): Promise<Awaited<ReturnType<typeof preparePrepaidSwtdChargeTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")
    if (!Number.isFinite(purchasedMinutes) || purchasedMinutes <= 0) {
      throw new Error("Invalid top up duration")
    }

    const prepaidUsd = (purchasedMinutes / 60) * STREAM_RATE_PER_HOUR_USD
    const prepaidSwtdAmount = (prepaidUsd / SWTD_USD_PRICE).toString()

    return preparePrepaidSwtdChargeTransaction(
      userRecord.walletAddress,
      prepaidSwtdAmount,
      "streams:topup",
    )
  },
})

export const submitStreamTopUpCharge = action({
  args: {
    signedTransactionBase64: v.string(),
    purchasedMinutes: v.number(),
  },
  handler: async (
    ctx,
    { signedTransactionBase64, purchasedMinutes },
  ): Promise<Awaited<ReturnType<typeof submitPrepaidSwtdChargeTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      _id: Id<"users">
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")
    if (!Number.isFinite(purchasedMinutes) || purchasedMinutes <= 0) {
      throw new Error("Invalid top up duration")
    }

    const result = await submitPrepaidSwtdChargeTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "streams:topup",
    )

    const activeSession = await ctx.runQuery(internal.streams.getActiveSessionForCreator, {
      userId: userRecord._id,
    })
    if (!activeSession) throw new Error("No active studio session")

    await ctx.runMutation(internal.streams.applyTopUpToActiveSession, {
      sessionId: activeSession._id,
      purchasedMinutes,
    })

    return result
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

export const prepareWithdrawToken = action({
  args: {
    token: v.union(v.literal("USDC"), v.literal("SWTD")),
    amount: v.number(),
    destinationWalletAddress: v.string(),
  },
  handler: async (
    ctx,
    { token, amount, destinationWalletAddress },
  ): Promise<Awaited<ReturnType<typeof prepareWithdrawalTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return prepareWithdrawalTransaction(
      userRecord.walletAddress,
      destinationWalletAddress,
      token as WithdrawToken,
      amount,
      "earnings:withdraw",
    )
  },
})

export const submitWithdrawToken = action({
  args: {
    signedTransactionBase64: v.string(),
  },
  handler: async (
    ctx,
    { signedTransactionBase64 },
  ): Promise<Awaited<ReturnType<typeof submitWithdrawalTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return submitWithdrawalTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "earnings:withdraw",
    )
  },
})

export const prepareBuySwtdSwap = action({
  args: {
    inputAmountBaseUnits: v.string(),
  },
  handler: async (
    ctx,
    { inputAmountBaseUnits },
  ): Promise<Awaited<ReturnType<typeof prepareBuySwtdSwapTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return prepareBuySwtdSwapTransaction(
      userRecord.walletAddress,
      inputAmountBaseUnits,
      "buy:swtd",
    )
  },
})

export const prepareBuySwtdMeteoraSwap = action({
  args: {
    inputAmountLamports: v.string(),
  },
  handler: async (
    ctx,
    { inputAmountLamports },
  ): Promise<Awaited<ReturnType<typeof prepareBuySwtdMeteoraSwapTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return prepareBuySwtdMeteoraSwapTransaction(
      userRecord.walletAddress,
      inputAmountLamports,
      "buy:swtd",
    )
  },
})

export const quoteBuySwtd = action({
  args: {
    inputAmountBaseUnits: v.string(),
  },
  handler: async (
    ctx,
    { inputAmountBaseUnits },
  ): Promise<Awaited<ReturnType<typeof quoteBuySwtdTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    return quoteBuySwtdTransaction(inputAmountBaseUnits, "buy:swtd")
  },
})

export const submitBuySwtdSwap = action({
  args: {
    signedTransactionBase64: v.string(),
  },
  handler: async (
    ctx,
    { signedTransactionBase64 },
  ): Promise<Awaited<ReturnType<typeof submitBuySwtdSwapTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return submitBuySwtdSwapTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "buy:swtd",
    )
  },
})
