import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase58Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  partiallySignTransactionMessageWithSigners,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit"
import {
  checkPlatformWalletProfileExists,
  deriveAssociatedTokenAddress,
  fetchMintProgramAddress,
  fetchUsdcAtaBalance,
  fetchWalletMintBalance,
  getPlatformWalletConfig,
} from "./platform-wallet"
import { SWITCHED_TOKEN_MINT, type WithdrawToken } from "./tokens"
import BN from "bn.js"
import { DynamicBondingCurveClient, getCurrentPoint } from "@meteora-ag/dynamic-bonding-curve-sdk"
import { CpAmm, getTokenProgram } from "@meteora-ag/cp-amm-sdk"
import {
  Connection,
  Keypair as Web3Keypair,
  PublicKey,
} from "@solana/web3.js"

const CREATE_STREAMER_DISCRIMINATOR = new Uint8Array([192, 22, 239, 153, 57, 26, 45, 12])
const WITHDRAW_DISCRIMINATOR = new Uint8Array([183, 18, 70, 156, 148, 109, 161, 34])
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111")
const TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
const USDC_DECIMALS = 6
const SOL_DECIMALS = 9
const SOL_MINT = "So11111111111111111111111111111111111111112"
const METEORA_SOL_USDC_POOL = "8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie"
const SWTD_METEORA_POOL = "Eye2RgcRZFub83Mfvfe3NnAK9MSAZx2iBsDJN3BDy7Q8"
const DEFAULT_SWAP_SLIPPAGE_BPS = 300
const MIN_SWAP_INPUT_BASE_UNITS = BigInt(1_000_000)
const TRANSFER_CHECKED_DISCRIMINATOR = 12

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

function getBroadcasterWeb3Keypair() {
  const privateKeyBase58 = process.env.SOLANA_BROADCASTER_PRIVATE_KEY
  if (!privateKeyBase58) throw new Error("Missing SOLANA_BROADCASTER_PRIVATE_KEY")

  const privateKey = Uint8Array.from(getBase58Encoder().encode(privateKeyBase58))
  return Web3Keypair.fromSecretKey(privateKey)
}

function encodeU64LE(value: bigint) {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return bytes
}

function encodeWithdrawParams(amountBaseUnits: bigint, gasInUsdcBaseUnits: bigint) {
  return new Uint8Array([
    ...WITHDRAW_DISCRIMINATOR,
    ...encodeU64LE(gasInUsdcBaseUnits),
    ...encodeU64LE(amountBaseUnits),
  ])
}

function encodeTransferCheckedParams(amountBaseUnits: bigint, decimals: number) {
  return new Uint8Array([
    TRANSFER_CHECKED_DISCRIMINATOR,
    ...encodeU64LE(amountBaseUnits),
    decimals,
  ])
}

function buildCreateAssociatedTokenAccountInstruction(
  payerAddress: ReturnType<typeof address>,
  associatedTokenAddress: string,
  ownerAddress: string,
  mintAddress: string,
  tokenProgramAddress: ReturnType<typeof address> = TOKEN_PROGRAM_ADDRESS,
) {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: payerAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: address(associatedTokenAddress), role: AccountRole.WRITABLE },
      { address: address(ownerAddress), role: AccountRole.READONLY },
      { address: address(mintAddress), role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: tokenProgramAddress, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([]),
  }
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

export async function prepareTipTransaction(
  senderWalletAddress: string,
  recipientWalletAddress: string,
  amount: number,
  logScope = "tips:send",
) {
  ensureRuntimePrimitives(logScope)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid tip amount")
  }

  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const broadcasterSigner = await getBroadcasterSigner()
  const { details: senderWallet, exists: senderExists } =
    await checkPlatformWalletProfileExists(senderWalletAddress)
  const { details: recipientWallet, exists: recipientExists } =
    await checkPlatformWalletProfileExists(recipientWalletAddress)

  if (!senderExists) {
    throw new Error("Sender wallet is not initialized")
  }

  if (!recipientExists) {
    throw new Error("Recipient wallet is not initialized")
  }

  const amountBaseUnits = BigInt(Math.round(amount * 10 ** USDC_DECIMALS))
  const gasInUsdcBaseUnits = BigInt(0)
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()

  console.log(`[${logScope}] preparing tip tx`, {
    senderWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    senderStreamerStatePda: senderWallet.platformWalletPda,
    senderStreamerAta: senderWallet.platformWalletUsdcAta,
    recipientWalletAddress,
    streamerStatePda: recipientWallet.platformWalletPda,
    streamerAta: recipientWallet.platformWalletUsdcAta,
    amount,
    amountBaseUnits: amountBaseUnits.toString(),
    gasInUsdcBaseUnits: gasInUsdcBaseUnits.toString(),
  })

  const instruction = {
    programAddress: address(config.programId),
    accounts: [
      { address: address(senderWalletAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: address(recipientWallet.platformWalletUsdcAta), role: AccountRole.WRITABLE },
      { address: address(senderWallet.platformWalletUsdcAta), role: AccountRole.WRITABLE },
      { address: address(config.usdcMint), role: AccountRole.READONLY },
      { address: address(senderWallet.globalStatePda), role: AccountRole.READONLY },
      { address: address(senderWallet.treasuryUsdcAta), role: AccountRole.WRITABLE },
      { address: address(senderWallet.platformWalletPda), role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: encodeWithdrawParams(amountBaseUnits, gasInUsdcBaseUnits),
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

  const unsignedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage)
  const wireTransactionBytes = getTransactionEncoder().encode(unsignedTransaction)
  const transactionBase64 = Buffer.from(wireTransactionBytes).toString("base64")

  return {
    senderWalletAddress,
    senderStreamerStatePda: senderWallet.platformWalletPda,
    senderStreamerAta: senderWallet.platformWalletUsdcAta,
    recipientWalletAddress,
    recipientStreamerStatePda: recipientWallet.platformWalletPda,
    recipientStreamerAta: recipientWallet.platformWalletUsdcAta,
    tokenMint: config.usdcMint,
    amount,
    transactionBase64,
  }
}

export async function submitTipTransaction(
  senderWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "tips:send",
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

  console.log(`[${logScope}] withdraw tip sent`, {
    senderWalletAddress,
    signature,
  })

  return {
    senderWalletAddress,
    tokenMint: config.usdcMint,
    signature,
  }
}

export async function prepareWithdrawalTransaction(
  senderWalletAddress: string,
  destinationWalletAddress: string,
  token: WithdrawToken,
  amount: number,
  logScope = "withdraw:token",
) {
  ensureRuntimePrimitives(logScope)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount")
  }

  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const broadcasterSigner = await getBroadcasterSigner()
  const normalizedDestinationWalletAddress = address(destinationWalletAddress)
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()

  if (token === "USDC") {
    const { details: senderWallet, exists } =
      await checkPlatformWalletProfileExists(senderWalletAddress)
    if (!exists) {
      throw new Error("Wallet setup incomplete")
    }

    const vaultBalance = await fetchUsdcAtaBalance(senderWallet.platformWalletUsdcAta)
    const amountBaseUnits = BigInt(Math.round(amount * 10 ** USDC_DECIMALS))
    if (BigInt(vaultBalance.amount) < amountBaseUnits) {
      throw new Error("Insufficient USDC balance")
    }

    const destinationAta = await deriveAssociatedTokenAddress(
      destinationWalletAddress,
      config.usdcMint,
    )
    const destinationAccount = await fetchEncodedAccount(rpc, address(destinationAta))

    console.log(`[${logScope}] preparing usdc withdraw tx`, {
      senderWalletAddress,
      broadcasterWalletAddress: broadcasterSigner.address,
      senderPlatformWalletPda: senderWallet.platformWalletPda,
      senderPlatformWalletAta: senderWallet.platformWalletUsdcAta,
      destinationWalletAddress: normalizedDestinationWalletAddress,
      destinationAta,
      amount,
      amountBaseUnits: amountBaseUnits.toString(),
      destinationAtaExists: destinationAccount.exists,
    })

    const withdrawInstruction = {
      programAddress: address(config.programId),
      accounts: [
        { address: address(senderWalletAddress), role: AccountRole.WRITABLE_SIGNER },
        { address: address(destinationAta), role: AccountRole.WRITABLE },
        { address: address(senderWallet.platformWalletUsdcAta), role: AccountRole.WRITABLE },
        { address: address(config.usdcMint), role: AccountRole.READONLY },
        { address: address(senderWallet.globalStatePda), role: AccountRole.READONLY },
        { address: address(senderWallet.treasuryUsdcAta), role: AccountRole.WRITABLE },
        { address: address(senderWallet.platformWalletPda), role: AccountRole.READONLY },
        { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ],
      data: encodeWithdrawParams(amountBaseUnits, BigInt(0)),
    }

    const transactionMessage = appendTransactionMessageInstruction(
      withdrawInstruction,
      !destinationAccount.exists
        ? appendTransactionMessageInstruction(
            buildCreateAssociatedTokenAccountInstruction(
              broadcasterSigner.address,
              destinationAta,
              destinationWalletAddress,
              config.usdcMint,
            ),
            setTransactionMessageLifetimeUsingBlockhash(
              latestBlockhash,
              setTransactionMessageFeePayerSigner(
                broadcasterSigner,
                createTransactionMessage({ version: 0 }),
              ),
            ),
          )
        : setTransactionMessageLifetimeUsingBlockhash(
            latestBlockhash,
            setTransactionMessageFeePayerSigner(
              broadcasterSigner,
              createTransactionMessage({ version: 0 }),
            ),
          ),
    )

    const unsignedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage)
    const wireTransactionBytes = getTransactionEncoder().encode(unsignedTransaction)

    return {
      token,
      tokenMint: config.usdcMint,
      senderWalletAddress,
      destinationWalletAddress: normalizedDestinationWalletAddress,
      destinationAta,
      amount,
      transactionBase64: Buffer.from(wireTransactionBytes).toString("base64"),
    }
  }

  const sourceBalance = await fetchWalletMintBalance(senderWalletAddress, SWITCHED_TOKEN_MINT)
  const switchedTokenProgramAddress = await fetchMintProgramAddress(SWITCHED_TOKEN_MINT)
  const mintSupply = await rpc
    .getTokenSupply(address(SWITCHED_TOKEN_MINT), { commitment: "confirmed" })
    .send()
  const decimals = mintSupply.value.decimals
  const amountBaseUnits = BigInt(Math.round(amount * 10 ** decimals))
  if (BigInt(sourceBalance.amount) < amountBaseUnits) {
    throw new Error("Insufficient token balance")
  }

  const destinationAta = await deriveAssociatedTokenAddress(
    destinationWalletAddress,
    SWITCHED_TOKEN_MINT,
    switchedTokenProgramAddress,
  )
  const destinationAccount = await fetchEncodedAccount(rpc, address(destinationAta))

  console.log(`[${logScope}] preparing swtd withdraw tx`, {
    senderWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    sourceAta: sourceBalance.ataAddress,
    destinationWalletAddress: normalizedDestinationWalletAddress,
    destinationAta,
    amount,
    amountBaseUnits: amountBaseUnits.toString(),
    decimals,
    tokenProgramAddress: switchedTokenProgramAddress,
    destinationAtaExists: destinationAccount.exists,
  })

  const transferInstruction = {
    programAddress: switchedTokenProgramAddress,
    accounts: [
      { address: address(sourceBalance.ataAddress), role: AccountRole.WRITABLE },
      { address: address(SWITCHED_TOKEN_MINT), role: AccountRole.READONLY },
      { address: address(destinationAta), role: AccountRole.WRITABLE },
      { address: address(senderWalletAddress), role: AccountRole.WRITABLE_SIGNER },
    ],
    data: encodeTransferCheckedParams(amountBaseUnits, decimals),
  }

  const transactionMessage = appendTransactionMessageInstruction(
    transferInstruction,
    !destinationAccount.exists
      ? appendTransactionMessageInstruction(
          buildCreateAssociatedTokenAccountInstruction(
            broadcasterSigner.address,
            destinationAta,
            destinationWalletAddress,
            SWITCHED_TOKEN_MINT,
            switchedTokenProgramAddress,
          ),
          setTransactionMessageLifetimeUsingBlockhash(
            latestBlockhash,
            setTransactionMessageFeePayerSigner(
              broadcasterSigner,
              createTransactionMessage({ version: 0 }),
            ),
          ),
        )
      : setTransactionMessageLifetimeUsingBlockhash(
          latestBlockhash,
          setTransactionMessageFeePayerSigner(
            broadcasterSigner,
            createTransactionMessage({ version: 0 }),
          ),
        ),
  )

  const unsignedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage)
  const wireTransactionBytes = getTransactionEncoder().encode(unsignedTransaction)

  return {
    token,
    tokenMint: SWITCHED_TOKEN_MINT,
    senderWalletAddress,
    destinationWalletAddress: normalizedDestinationWalletAddress,
    destinationAta,
    amount,
    transactionBase64: Buffer.from(wireTransactionBytes).toString("base64"),
  }
}

export async function submitWithdrawalTransaction(
  senderWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "withdraw:token",
) {
  const signedTransactionBytes = Buffer.from(signedTransactionBase64, "base64")
  const signedTransaction = getTransactionDecoder().decode(signedTransactionBytes)
  assertIsFullySignedTransaction(signedTransaction)
  assertIsTransactionWithinSizeLimit(signedTransaction)

  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const sendTransactionWithoutConfirming = sendTransactionWithoutConfirmingFactory({ rpc })

  await sendTransactionWithoutConfirming(signedTransaction, { commitment: "confirmed" })
  const signature = getSignatureFromTransaction(signedTransaction)

  console.log(`[${logScope}] withdraw sent`, {
    senderWalletAddress,
    signature,
  })

  return {
    senderWalletAddress,
    signature,
  }
}

export async function prepareBuySwtdSwapTransaction(
  userWalletAddress: string,
  inputAmountBaseUnits: string,
  logScope = "buy:swtd",
) {
  ensureRuntimePrimitives(logScope)

  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])

  const amountBaseUnits = BigInt(inputAmountBaseUnits)
  if (amountBaseUnits <= BigInt(0)) {
    throw new Error("Invalid swap amount")
  }
  if (amountBaseUnits < MIN_SWAP_INPUT_BASE_UNITS) {
    throw new Error("Swap amount is below minimum")
  }

  const connection = new Connection(config.rpcUrl, "confirmed")
  const cpAmm = new CpAmm(connection)
  const broadcasterKeypair = getBroadcasterWeb3Keypair()
  const broadcasterPublicKey = broadcasterKeypair.publicKey
  const userPublicKey = new PublicKey(userWalletAddress)
  const poolPublicKey = new PublicKey(METEORA_SOL_USDC_POOL)
  const poolState = await cpAmm.fetchPoolState(poolPublicKey)
  const amountIn = new BN(amountBaseUnits.toString())
  const currentSlot = await connection.getSlot("confirmed")
  const currentTime = Math.floor(Date.now() / 1000)

  const quote = cpAmm.getQuote({
    inAmount: amountIn,
    inputTokenMint: new PublicKey(config.usdcMint),
    slippage: DEFAULT_SWAP_SLIPPAGE_BPS,
    poolState,
    currentTime,
    currentSlot,
    tokenADecimal: poolState.tokenAMint.toBase58() === config.usdcMint ? USDC_DECIMALS : SOL_DECIMALS,
    tokenBDecimal: poolState.tokenBMint.toBase58() === SOL_MINT ? SOL_DECIMALS : USDC_DECIMALS,
    hasReferral: false,
  })

  const transactionBuilder = cpAmm.swap({
    payer: broadcasterPublicKey,
    receiver: userPublicKey,
    pool: poolPublicKey,
    inputTokenMint: new PublicKey(config.usdcMint),
    outputTokenMint: new PublicKey(SOL_MINT),
    amountIn,
    minimumAmountOut: quote.minSwapOutAmount,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: getTokenProgram(poolState.tokenAFlag),
    tokenBProgram: getTokenProgram(poolState.tokenBFlag),
    referralTokenAccount: null,
    poolState,
  })
  const transaction = await transactionBuilder
  const { blockhash } = await connection.getLatestBlockhash("confirmed")
  transaction.recentBlockhash = blockhash
  transaction.feePayer = broadcasterPublicKey
  transaction.partialSign(broadcasterKeypair)

  console.log(`[${logScope}] prepared meteora usdc-sol swap`, {
    userWalletAddress,
    payerAddress: broadcasterPublicKey.toBase58(),
    receiverAddress: userWalletAddress,
    poolAddress: METEORA_SOL_USDC_POOL,
    inputMint: config.usdcMint,
    outputMint: SOL_MINT,
    inAmount: quote.swapInAmount.toString(),
    outAmount: quote.swapOutAmount.toString(),
    minimumAmountOut: quote.minSwapOutAmount.toString(),
  })

  return {
    provider: "meteora" as const,
    inputMint: config.usdcMint,
    outputMint: SOL_MINT,
    inputAmountBaseUnits: quote.swapInAmount.toString(),
    outputAmountBaseUnits: quote.swapOutAmount.toString(),
    outputDecimals: SOL_DECIMALS,
    outputUiAmount: (
      Number(quote.swapOutAmount.toString()) / 10 ** SOL_DECIMALS
    ).toString(),
    transactionBase64: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  }
}

export async function quoteBuySwtdTransaction(
  inputAmountBaseUnits: string,
  logScope = "buy:swtd",
) {
  ensureRuntimePrimitives(logScope)

  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const amountBaseUnits = BigInt(inputAmountBaseUnits)

  if (amountBaseUnits <= BigInt(0)) {
    throw new Error("Invalid swap amount")
  }
  if (amountBaseUnits < MIN_SWAP_INPUT_BASE_UNITS) {
    throw new Error("Swap amount is below minimum")
  }

  const connection = new Connection(config.rpcUrl, "confirmed")
  const cpAmm = new CpAmm(connection)
  const usdcSolPoolPublicKey = new PublicKey(METEORA_SOL_USDC_POOL)
  const usdcSolPoolState = await cpAmm.fetchPoolState(usdcSolPoolPublicKey)
  const amountIn = new BN(amountBaseUnits.toString())
  const currentSlot = await connection.getSlot("confirmed")
  const currentTime = Math.floor(Date.now() / 1000)

  const usdcToSolQuote = cpAmm.getQuote({
    inAmount: amountIn,
    inputTokenMint: new PublicKey(config.usdcMint),
    slippage: DEFAULT_SWAP_SLIPPAGE_BPS,
    poolState: usdcSolPoolState,
    currentTime,
    currentSlot,
    tokenADecimal:
      usdcSolPoolState.tokenAMint.toBase58() === config.usdcMint
        ? USDC_DECIMALS
        : SOL_DECIMALS,
    tokenBDecimal:
      usdcSolPoolState.tokenBMint.toBase58() === SOL_MINT
        ? SOL_DECIMALS
        : USDC_DECIMALS,
    hasReferral: false,
  })

  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed")
  const swtdPoolPublicKey = new PublicKey(SWTD_METEORA_POOL)
  const swtdPoolState = await dbcClient.state.getPool(swtdPoolPublicKey)
  if (!swtdPoolState) {
    throw new Error("Meteora pool not found")
  }

  const swtdConfigState = await dbcClient.state.getPoolConfig(swtdPoolState.config)
  if (!swtdConfigState) {
    throw new Error("Meteora pool config not found")
  }

  const currentPoint = await getCurrentPoint(connection, swtdConfigState.activationType)
  const solToSwtdQuote = dbcClient.pool.swapQuote({
    virtualPool: swtdPoolState,
    config: swtdConfigState,
    swapBaseForQuote: false,
    amountIn: usdcToSolQuote.swapOutAmount,
    slippageBps: DEFAULT_SWAP_SLIPPAGE_BPS,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  })
  const quotedSwtdOutputAmount = (solToSwtdQuote as unknown as { outputAmount: BN }).outputAmount
  const outputSupply = await rpc
    .getTokenSupply(address(SWITCHED_TOKEN_MINT), { commitment: "confirmed" })
    .send()

  console.log(`[${logScope}] quoted buy swtd`, {
    inputMint: config.usdcMint,
    outputMint: SWITCHED_TOKEN_MINT,
    inputAmountBaseUnits: amountBaseUnits.toString(),
    intermediateSolLamports: usdcToSolQuote.swapOutAmount.toString(),
    outputAmountBaseUnits: quotedSwtdOutputAmount.toString(),
  })

  return {
    inputMint: config.usdcMint,
    outputMint: SWITCHED_TOKEN_MINT,
    inputAmountBaseUnits: amountBaseUnits.toString(),
    intermediateSolLamports: usdcToSolQuote.swapOutAmount.toString(),
    outputAmountBaseUnits: quotedSwtdOutputAmount.toString(),
    outputDecimals: outputSupply.value.decimals,
    outputUiAmount: (
      Number(quotedSwtdOutputAmount.toString()) / 10 ** outputSupply.value.decimals
    ).toString(),
  }
}

export async function prepareBuySwtdMeteoraSwapTransaction(
  userWalletAddress: string,
  inputAmountLamports: string,
  logScope = "buy:swtd",
) {
  ensureRuntimePrimitives(logScope)

  const config = getPlatformWalletConfig()
  const rpc = createSolanaRpc(config.rpcUrl as Parameters<typeof createSolanaRpc>[0])
  const amountLamports = BigInt(inputAmountLamports)
  if (amountLamports <= BigInt(0)) {
    throw new Error("Invalid SOL swap amount")
  }

  const connection = new Connection(config.rpcUrl, "confirmed")
  const client = new DynamicBondingCurveClient(connection, "confirmed")
  const broadcasterKeypair = getBroadcasterWeb3Keypair()
  const broadcasterPublicKey = broadcasterKeypair.publicKey
  const userPublicKey = new PublicKey(userWalletAddress)
  const poolPublicKey = new PublicKey(SWTD_METEORA_POOL)
  const amountIn = new BN(amountLamports.toString())
  const outputSupply = await rpc
    .getTokenSupply(address(SWITCHED_TOKEN_MINT), { commitment: "confirmed" })
    .send()

  const poolState = await client.state.getPool(poolPublicKey)
  if (!poolState) {
    throw new Error("Meteora pool not found")
  }

  const configState = await client.state.getPoolConfig(poolState.config)
  if (!configState) {
    throw new Error("Meteora pool config not found")
  }

  const currentPoint = await getCurrentPoint(connection, configState.activationType)
  const quote = client.pool.swapQuote({
    virtualPool: poolState,
    config: configState,
    swapBaseForQuote: false,
    amountIn,
    slippageBps: DEFAULT_SWAP_SLIPPAGE_BPS,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  })
  const quotedOutputAmount = (quote as unknown as { outputAmount: BN }).outputAmount

  const transaction = await client.pool.swap({
    owner: userPublicKey,
    payer: broadcasterPublicKey,
    pool: poolPublicKey,
    amountIn,
    minimumAmountOut: quote.minimumAmountOut,
    swapBaseForQuote: false,
    referralTokenAccount: null,
  })

  const { blockhash } = await connection.getLatestBlockhash("confirmed")
  transaction.recentBlockhash = blockhash
  transaction.feePayer = broadcasterPublicKey
  transaction.partialSign(broadcasterKeypair)

  console.log(`[${logScope}] prepared meteora swap`, {
    userWalletAddress,
    payerAddress: broadcasterPublicKey.toBase58(),
    poolAddress: SWTD_METEORA_POOL,
    inputMint: SOL_MINT,
    outputMint: SWITCHED_TOKEN_MINT,
    inputAmountLamports: amountLamports.toString(),
    outAmount: quotedOutputAmount.toString(),
    minimumAmountOut: quote.minimumAmountOut.toString(),
  })

  return {
    provider: "meteora" as const,
    inputMint: SOL_MINT,
    outputMint: SWITCHED_TOKEN_MINT,
    inputAmountBaseUnits: amountLamports.toString(),
    outputAmountBaseUnits: quotedOutputAmount.toString(),
    outputDecimals: outputSupply.value.decimals,
    outputUiAmount: (
      Number(quotedOutputAmount.toString()) / 10 ** outputSupply.value.decimals
    ).toString(),
    transactionBase64: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  }
}

export async function submitBuySwtdSwapTransaction(
  userWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "buy:swtd",
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

  console.log(`[${logScope}] buy swap sent`, {
    userWalletAddress,
    signature,
  })

  return {
    userWalletAddress,
    signature,
  }
}
