export const SWITCHED_TOKEN_MINT = "mLpmTV7yBWUysSw9pQaqRqfhwcaYizSPVfPaRGycyai"

export const WITHDRAW_TOKEN_OPTIONS = {
  SWTD: {
    symbol: "$SWTD",
    mint: SWITCHED_TOKEN_MINT,
  },
  USDC: {
    symbol: "USDC",
  },
} as const

export type WithdrawToken = keyof typeof WITHDRAW_TOKEN_OPTIONS
