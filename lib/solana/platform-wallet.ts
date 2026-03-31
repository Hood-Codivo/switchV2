import {
  address,
  createSolanaRpc,
  fetchEncodedAccount,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit"

const TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
const DEFAULT_PROGRAM_ID = "swinS25mqCw6ExEAtLJFxp6HYcqMvoYxKz3by6FfbRD"
const DEFAULT_MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const DEFAULT_DEVNET_USDC_MINT = "2o39Cm7hzaXmm9zGGGsa5ZiveJ93oMC2D6U7wfsREcCo"
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com"
const DEFAULT_STREAMER_SEED = "user"
const GLOBAL_STATE_SEED = "global_state"

type PlatformWalletConfig = {
  programId: string
  usdcMint: string
  rpcUrl: string
  seed: string
}

export type PlatformWalletDetails = {
  userWalletAddress: string
  platformWalletPda: string
  platformWalletPdaBump: number
  platformWalletUsdcAta: string
  globalStatePda: string
  globalStatePdaBump: number
  treasuryUsdcAta: string
}

export type PlatformWalletProfileStatus = {
  details: PlatformWalletDetails
  exists: boolean
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    console.error(`[platform-wallet] Missing required env var: ${name}`)
    throw new Error(`Missing ${name}`)
  }
  return value
}

export function getPlatformWalletConfig(): PlatformWalletConfig {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC_URL
  const defaultUsdcMint = rpcUrl.includes("devnet")
    ? DEFAULT_DEVNET_USDC_MINT
    : DEFAULT_MAINNET_USDC_MINT

  return {
    programId: process.env.NEXT_PUBLIC_PLATFORM_WALLET_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
    usdcMint: process.env.NEXT_PUBLIC_USDC_MINT ?? defaultUsdcMint,
    rpcUrl,
    seed: process.env.NEXT_PUBLIC_PLATFORM_WALLET_SEED ?? DEFAULT_STREAMER_SEED,
  }
}

export async function derivePlatformWallet(userWalletAddress: string): Promise<PlatformWalletDetails> {
  const config = getPlatformWalletConfig()
  const encoder = getAddressEncoder()
  const walletAddress = address(userWalletAddress)
  const programAddress = address(config.programId)

  const [globalStatePda, globalStatePdaBump] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode(GLOBAL_STATE_SEED)],
  })

  const [platformWalletPda, platformWalletPdaBump] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode(config.seed), encoder.encode(walletAddress)],
  })

  const [platformWalletUsdcAta] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      encoder.encode(platformWalletPda),
      encoder.encode(TOKEN_PROGRAM_ADDRESS),
      encoder.encode(address(config.usdcMint)),
    ],
  })

  const [treasuryUsdcAta] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      encoder.encode(globalStatePda),
      encoder.encode(TOKEN_PROGRAM_ADDRESS),
      encoder.encode(address(config.usdcMint)),
    ],
  })

  return {
    userWalletAddress,
    platformWalletPda,
    platformWalletPdaBump,
    platformWalletUsdcAta,
    globalStatePda,
    globalStatePdaBump,
    treasuryUsdcAta,
  }
}

export async function fetchUsdcAtaBalance(ataAddress: string) {
  const { rpcUrl } = getPlatformWalletConfig()
  const rpc = createSolanaRpc(rpcUrl as Parameters<typeof createSolanaRpc>[0])

  try {
    const response = await rpc
      .getTokenAccountBalance(address(ataAddress), { commitment: "confirmed" })
      .send()
    return {
      amount: response.value.amount,
      decimals: response.value.decimals,
      uiAmountString: response.value.uiAmountString,
    }
  } catch {
    return {
      amount: "0",
      decimals: 6,
      uiAmountString: "0",
    }
  }
}

export async function checkPlatformWalletProfileExists(
  userWalletAddress: string,
): Promise<PlatformWalletProfileStatus> {
  const config = getPlatformWalletConfig()
  const details = await derivePlatformWallet(userWalletAddress)
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const account = await fetchEncodedAccount(rpc, address(details.platformWalletPda))
  const expectedProgramAddress = address(config.programId)
  const exists = account.exists && account.programAddress === expectedProgramAddress

  console.log("[platform-wallet] profile check", {
    userWalletAddress,
    platformWalletPda: details.platformWalletPda,
    platformWalletUsdcAta: details.platformWalletUsdcAta,
    globalStatePda: details.globalStatePda,
    rpcUrl: config.rpcUrl,
    exists: account.exists,
    ownerProgram: account.exists ? account.programAddress : null,
    expectedProgram: expectedProgramAddress,
    matchesProgram: account.exists ? account.programAddress === expectedProgramAddress : false,
  })

  return {
    details,
    exists,
  }
}

export function truncateAddress(value: string, start = 4, end = 4) {
  if (value.length <= start + end + 3) return value
  return `${value.slice(0, start)}...${value.slice(-end)}`
}
