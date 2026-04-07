"use node"

import { v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import {
  prepareBuySwtdMeteoraSwapTransaction,
  prepareBuySwtdSwapTransaction,
  preparePlatformWalletCreationTransaction,
  prepareWithdrawalTransaction,
  quoteBuySwtdTransaction,
  submitBuySwtdSwapTransaction,
  submitPlatformWalletCreationTransaction,
  submitWithdrawalTransaction,
} from "../lib/solana/server-platform-wallet"
import type { WithdrawToken } from "../lib/solana/tokens"

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
