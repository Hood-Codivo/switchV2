import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransactionMessageWithSigners,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit"
import { checkPlatformWalletProfileExists, getPlatformWalletConfig } from "./platform-wallet"

const CREATE_STREAMER_DISCRIMINATOR = new Uint8Array([192, 22, 239, 153, 57, 26, 45, 12])
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111")
const TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

function ensureRuntimePrimitives(logScope: string) {
  if (typeof globalThis.queueMicrotask !== "function") {
    Object.defineProperty(globalThis, "queueMicrotask", {
      configurable: true,
      value: (callback: VoidFunction) => Promise.resolve().then(callback),
    })
  }

  if (globalThis.isSecureContext !== true) {
    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value: true,
    })
  }

  console.log(`[${logScope}] crypto environment`, {
    hasCrypto: !!globalThis.crypto,
    hasSubtleCrypto: !!globalThis.crypto?.subtle,
    isSecureContext: globalThis.isSecureContext,
    hasQueueMicrotask: typeof globalThis.queueMicrotask === "function",
  })
}

async function getBroadcasterSigner() {
  const privateKeyBase58 = process.env.SOLANA_BROADCASTER_PRIVATE_KEY
  if (!privateKeyBase58) throw new Error("Missing SOLANA_BROADCASTER_PRIVATE_KEY")

  const privateKey = getBase58Encoder().encode(privateKeyBase58)
  return createKeyPairSignerFromBytes(privateKey)
}

export async function preparePlatformWalletCreationTransaction(
  userWalletAddress: string,
  logScope = "wallet",
) {
  ensureRuntimePrimitives(logScope)

  const config = getPlatformWalletConfig()
  const { details: derivedWallet, exists } = await checkPlatformWalletProfileExists(userWalletAddress)
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const globalStateAccount = await rpc
    .getAccountInfo(address(derivedWallet.globalStatePda), { commitment: "confirmed" })
    .send()

  console.log(`[${logScope}] ensure platform wallet`, {
    userWalletAddress,
    platformWalletPda: derivedWallet.platformWalletPda,
    platformWalletUsdcAta: derivedWallet.platformWalletUsdcAta,
    globalStatePda: derivedWallet.globalStatePda,
    exists,
    globalStateExists: globalStateAccount.value !== null,
  })

  if (exists) {
    console.log(`[${logScope}] platform wallet already exists`, {
      userWalletAddress,
      platformWalletPda: derivedWallet.platformWalletPda,
    })
    return { ...derivedWallet, exists: true as const, transactionBase64: null }
  }

  if (globalStateAccount.value === null) {
    throw new Error("Global state account is not initialized")
  }

  const broadcasterSigner = await getBroadcasterSigner()

  console.log(`[${logScope}] preparing platform wallet tx`, {
    userWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    platformWalletPda: derivedWallet.platformWalletPda,
    platformWalletUsdcAta: derivedWallet.platformWalletUsdcAta,
  })

  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()

  const instruction = {
    programAddress: address(config.programId),
    accounts: [
      { address: address(userWalletAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: broadcasterSigner.address, role: AccountRole.WRITABLE_SIGNER, signer: broadcasterSigner },
      { address: address(derivedWallet.platformWalletPda), role: AccountRole.WRITABLE },
      { address: address(config.usdcMint), role: AccountRole.READONLY },
      { address: address(derivedWallet.platformWalletUsdcAta), role: AccountRole.WRITABLE },
      { address: address(derivedWallet.globalStatePda), role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: CREATE_STREAMER_DISCRIMINATOR,
  }

  const transactionMessage = appendTransactionMessageInstruction(
    instruction,
    setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      setTransactionMessageFeePayerSigner(
        broadcasterSigner,
        createTransactionMessage({ version: 0 }),
      ),
    ),
  )

  const partiallySignedTransaction = await partiallySignTransactionMessageWithSigners(
    transactionMessage,
  )
  const wireTransactionBytes = getTransactionEncoder().encode(partiallySignedTransaction)
  const transactionBase64 = Buffer.from(wireTransactionBytes).toString("base64")

  return { ...derivedWallet, exists: false as const, transactionBase64 }
}

export async function submitPlatformWalletCreationTransaction(
  userWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "wallet",
) {
  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const signedTransactionBytes = Buffer.from(signedTransactionBase64, "base64")
  const signedTransaction = getTransactionDecoder().decode(signedTransactionBytes)
  assertIsFullySignedTransaction(signedTransaction)
  assertIsTransactionWithinSizeLimit(signedTransaction)
  const sendTransactionWithoutConfirming = sendTransactionWithoutConfirmingFactory({ rpc })

  await sendTransactionWithoutConfirming(signedTransaction, { commitment: "confirmed" })
  const signature = getSignatureFromTransaction(signedTransaction)

  console.log(`[${logScope}] create_streamer sent`, {
    userWalletAddress,
    signature,
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const { details, exists } = await checkPlatformWalletProfileExists(userWalletAddress)
    if (exists) {
      return { ...details, created: true as const, signature }
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }

  throw new Error("Platform wallet transaction submitted but account was not observed on-chain")
}
