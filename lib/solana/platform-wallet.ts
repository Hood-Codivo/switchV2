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

export async function deriveAssociatedTokenAddress(
  ownerAddress: string,
  mintAddress: string,
) {
  const encoder = getAddressEncoder()

  const [associatedTokenAddress] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      encoder.encode(address(ownerAddress)),
      encoder.encode(TOKEN_PROGRAM_ADDRESS),
      encoder.encode(address(mintAddress)),
    ],
  })

  return associatedTokenAddress
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

  const platformWalletUsdcAta = await deriveAssociatedTokenAddress(platformWalletPda, config.usdcMint)
  const treasuryUsdcAta = await deriveAssociatedTokenAddress(globalStatePda, config.usdcMint)

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

export async function fetchWalletMintBalance(
  walletAddress: string,
  mintAddress?: string,
) {
  const { rpcUrl } = getPlatformWalletConfig()
  const rpc = createSolanaRpc(rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const resolvedMintAddress = mintAddress ?? getPlatformWalletConfig().usdcMint
  const derivedAtaAddress = await deriveAssociatedTokenAddress(walletAddress, resolvedMintAddress)

  try {
    const response = await rpc
      .getTokenAccountsByOwner(
        address(walletAddress),
        { mint: address(resolvedMintAddress) },
        { commitment: "confirmed", encoding: "jsonParsed" },
      )
      .send()

    const tokenAccounts = (response.value ?? [])
      .map((entry) => {
        const parsed = (entry.account.data as {
          parsed?: {
            info?: {
              state?: string
              tokenAmount?: {
                amount?: string
                decimals?: number
                uiAmountString?: string
              }
            }
          }
        }).parsed

        return {
          pubkey: entry.pubkey,
          state: parsed?.info?.state,
          amount: parsed?.info?.tokenAmount?.amount ?? "0",
          decimals: parsed?.info?.tokenAmount?.decimals ?? 6,
          uiAmountString: parsed?.info?.tokenAmount?.uiAmountString ?? "0",
        }
      })
      .filter((entry) => entry.state === "initialized")

    const preferredAccount =
      tokenAccounts.find((entry) => entry.pubkey === derivedAtaAddress) ??
      tokenAccounts.sort((a, b) => Number(b.amount) - Number(a.amount))[0]

    console.log("[platform-wallet] balance lookup", {
      walletAddress,
      mintAddress: resolvedMintAddress,
      derivedAtaAddress,
      tokenAccounts,
      selectedAccount: preferredAccount ?? null,
      rpcUrl,
    })

    if (preferredAccount) {
      return {
        ataAddress: preferredAccount.pubkey,
        mintAddress: resolvedMintAddress,
        amount: preferredAccount.amount,
        decimals: preferredAccount.decimals,
        uiAmountString: preferredAccount.uiAmountString,
      }
    }
  } catch (error) {
    console.log("[platform-wallet] owner token account lookup failed", {
      walletAddress,
      mintAddress: resolvedMintAddress,
      error,
    })
  }

  const balance = await fetchUsdcAtaBalance(derivedAtaAddress)

  console.log("[platform-wallet] balance lookup fallback", {
    walletAddress,
    mintAddress: resolvedMintAddress,
    derivedAtaAddress,
    fallbackBalance: balance,
    rpcUrl,
  })

  return {
    ataAddress: derivedAtaAddress,
    mintAddress: resolvedMintAddress,
    ...balance,
  }
}

export async function fetchWalletUsdcBalance(walletAddress: string) {
  return fetchWalletMintBalance(walletAddress, getPlatformWalletConfig().usdcMint)
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
