"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  chargeApprovedSwtdBlockTransaction,
  prepareBuySwtdMeteoraSwapTransaction,
  prepareBuySwtdSwapTransaction,
  prepareDirectSwtdChargeTransaction,
  prepareStreamSpendingApprovalTransaction,
  preparePlatformWalletCreationTransaction,
  prepareWithdrawalTransaction,
  quoteBuySwtdTransaction,
  submitBuySwtdSwapTransaction,
  submitStreamSpendingApprovalTransaction,
  submitPlatformWalletCreationTransaction,
  submitWithdrawalTransaction,
} from "../lib/solana/server-platform-wallet"
import type { WithdrawToken } from "../lib/solana/tokens"
import { getSwtdCoverage } from "../lib/stream-billing"
import { fetchWalletMintBalance } from "../lib/solana/platform-wallet"
import { SWITCHED_TOKEN_MINT } from "../lib/solana/tokens"

const streamSessionPlanValidator = v.object({
  plannedMinutes: v.number(),
  allowExtraUsageSpending: v.boolean(),
  overtimeMinutes: v.number(),
})

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
    { sessionPlan: _sessionPlan },
  ): Promise<Awaited<ReturnType<typeof prepareDirectSwtdChargeTransaction>>> => {
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
    if (activeSession?.spendingApprovedAt) {
      const swtdBalance = await fetchWalletMintBalance(
        userRecord.walletAddress,
        SWITCHED_TOKEN_MINT,
      )
      const coverage = getSwtdCoverage(Number(swtdBalance.uiAmountString ?? "0"))
      await ctx.runMutation(internal.streams.attachBillingPlanToSession, {
        sessionId: activeSession._id,
        billing: {
          spendingLimitMinutes: coverage.chargeableMinutes,
          allowExtraUsageSpending: true,
          spendingLimitUsd: coverage.approvalUsd,
          spendingLimitSwtdAmount: coverage.swtdBalance.toString(),
          billingState: "active",
          chargedMinutes: activeSession.chargedMinutes ?? 0,
          remainingApprovedMinutes: coverage.chargeableMinutes,
          chargeBlockMinutes: coverage.blockMinutes,
          nextChargeAt: undefined,
          graceStartedAt: undefined,
        },
      })
      return {
        tokenMint: "mLpmTV7yBWUysSw9pQaqRqfhwcaYizSPVfPaRGycyai",
        senderWalletAddress: userRecord.walletAddress,
        destinationWalletAddress: userRecord.walletAddress,
        destinationAta: userRecord.walletAddress,
        amount: coverage.swtdBalance,
        transactionBase64: "",
      } as Awaited<ReturnType<typeof prepareStreamSpendingApprovalTransaction>>
    }

    const swtdBalance = await fetchWalletMintBalance(
      userRecord.walletAddress,
      SWITCHED_TOKEN_MINT,
    )
    const coverage = getSwtdCoverage(Number(swtdBalance.uiAmountString ?? "0"))
    if (coverage.swtdBalance <= 0) {
      throw new Error("Insufficient $SWTD balance")
    }
    if (coverage.chargeableMinutes < coverage.blockMinutes) {
      throw new Error("Need at least 30 minutes worth of $SWTD to go live")
    }

    return prepareStreamSpendingApprovalTransaction(
      userRecord.walletAddress,
      coverage.swtdBalance.toString(),
      "streams:approval",
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
  ): Promise<Awaited<ReturnType<typeof submitStreamSpendingApprovalTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      _id: Id<"users">
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    const result = await submitStreamSpendingApprovalTransaction(
      userRecord.walletAddress,
      signedTransactionBase64,
      "streams:approval",
    )

    const activeSession = await ctx.runQuery(internal.streams.getActiveSessionForCreator, {
      userId: userRecord._id,
    })
    if (activeSession) {
      const swtdBalance = await fetchWalletMintBalance(
        userRecord.walletAddress,
        SWITCHED_TOKEN_MINT,
      )
      const coverage = getSwtdCoverage(Number(swtdBalance.uiAmountString ?? "0"))
      await ctx.runMutation(internal.streams.markPrepaidChargeOnSession, {
        sessionId: activeSession._id,
        signature: result.signature,
        chargedAt: Date.now(),
      })
      await ctx.runMutation(internal.streams.attachBillingPlanToSession, {
        sessionId: activeSession._id,
        billing: {
          spendingLimitMinutes: coverage.chargeableMinutes,
          allowExtraUsageSpending: true,
          spendingLimitUsd: coverage.approvalUsd,
          spendingLimitSwtdAmount: coverage.swtdBalance.toString(),
          billingState: "active",
          chargedMinutes: 0,
          remainingApprovedMinutes: coverage.chargeableMinutes,
          chargeBlockMinutes: coverage.blockMinutes,
          nextChargeAt: undefined,
          graceStartedAt: undefined,
        },
      })
    }

    return result
  },
})

export const chargeApprovedStreamBlock = action({
  args: {
    chargeMinutes: v.number(),
  },
  handler: async (ctx, { chargeMinutes }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")

    return chargeApprovedSwtdBlockTransaction(
      userRecord.walletAddress,
      chargeMinutes,
      "streams:billing",
    )
  },
})

export const prepareStreamTopUpCharge = action({
  args: {
    purchasedMinutes: v.number(),
  },
  handler: async (
    ctx,
    { purchasedMinutes },
  ): Promise<Awaited<ReturnType<typeof prepareStreamSpendingApprovalTransaction>>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const userRecord = await ctx.runQuery(api.users.getCurrentUser, {}) as {
      walletAddress?: string
    } | null
    if (!userRecord?.walletAddress) throw new Error("Wallet setup incomplete")
    if (!Number.isFinite(purchasedMinutes) || purchasedMinutes <= 0) {
      throw new Error("Invalid top up duration")
    }

    const prepaidSwtdAmount = (
      ((purchasedMinutes / 60) * 0.5) /
      0.00000536288
    ).toString()

    return prepareDirectSwtdChargeTransaction(
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
  ): Promise<Awaited<ReturnType<typeof submitStreamSpendingApprovalTransaction>>> => {
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

    const result = await submitStreamSpendingApprovalTransaction(
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
