"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { api } from "@/convex/_generated/api";
import { usePlatformWallet } from "@/hooks/use-platform-wallet";
import { useWalletMintBalance } from "@/hooks/use-wallet-mint-balance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDownLeft, ArrowUpRight, Wallet, Coins } from "lucide-react";
import { SWITCHED_TOKEN_MINT, type WithdrawToken } from "@/lib/solana/tokens";

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet";

function formatTokenBalance(value?: string | null) {
  const amount = Number(value ?? "0");
  if (!Number.isFinite(amount)) return "0.000";
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function decodeBase64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function encodeBytesToBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EarningsPage() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const tipHistory = useQuery(api.tips.listMyTipHistory, {});
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const prepareEnsurePlatformWallet = useAction(
    api.serverPlatformWallet.prepareEnsurePlatformWallet,
  );
  const submitEnsurePlatformWallet = useAction(
    api.serverPlatformWallet.submitEnsurePlatformWallet,
  );
  const prepareWithdrawToken = useAction(
    api.serverPlatformWallet.prepareWithdrawToken,
  );
  const submitWithdrawToken = useAction(
    api.serverPlatformWallet.submitWithdrawToken,
  );
  const { usdcBalance, loading: walletLoading } = usePlatformWallet(
    currentUser?.walletAddress,
  );
  const { balance: swtdBalance, loading: swtdLoading } = useWalletMintBalance(
    currentUser?.walletAddress,
    SWITCHED_TOKEN_MINT,
  );

  const [withdrawToken, setWithdrawToken] = useState<WithdrawToken>("USDC");
  const [withdrawStep, setWithdrawStep] = useState<1 | 2>(1);
  const [destinationWalletAddress, setDestinationWalletAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawStatus, setWithdrawStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const selectedBalance = withdrawToken === "USDC" ? usdcBalance : swtdBalance;
  const selectedBalanceLoading =
    withdrawToken === "USDC" ? walletLoading : swtdLoading;

  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawStatus({ type: "error", message: "Enter a valid amount" });
      return;
    }
    if (!destinationWalletAddress.trim()) {
      setWithdrawStatus({
        type: "error",
        message: "Enter a destination wallet",
      });
      return;
    }

    setWithdrawing(true);
    setWithdrawStatus(null);

    try {
      const walletAddress = currentUser?.walletAddress;
      const embeddedWallet = walletAddress
        ? solanaWallets.find((wallet) => wallet.address === walletAddress)
        : null;

      if (!walletAddress || !embeddedWallet) {
        throw new Error("Wallet not ready yet");
      }

      if (selectedBalance && amount > Number(selectedBalance)) {
        throw new Error("Insufficient token balance");
      }

      if (withdrawToken === "USDC") {
        const walletSetup = await prepareEnsurePlatformWallet({});
        if (!walletSetup.exists && walletSetup.transactionBase64) {
          const walletSetupSignature = await signTransaction({
            wallet: embeddedWallet,
            chain: solanaChain,
            transaction: decodeBase64ToBytes(walletSetup.transactionBase64),
          });

          await submitEnsurePlatformWallet({
            signedTransactionBase64: encodeBytesToBase64(
              walletSetupSignature.signedTransaction,
            ),
          });
        }
      }

      const preparedWithdrawal = await prepareWithdrawToken({
        token: withdrawToken,
        amount,
        destinationWalletAddress: destinationWalletAddress.trim(),
      });
      const signedWithdrawal = await signTransaction({
        wallet: embeddedWallet,
        chain: solanaChain,
        transaction: decodeBase64ToBytes(preparedWithdrawal.transactionBase64),
      });
      await submitWithdrawToken({
        signedTransactionBase64: encodeBytesToBase64(
          signedWithdrawal.signedTransaction,
        ),
      });

      setWithdrawStatus({
        type: "success",
        message: `Withdrew ${amount} ${withdrawToken} successfully`,
      });
      setWithdrawAmount("");
      setDestinationWalletAddress("");
      setWithdrawStep(1);
    } catch (err) {
      console.error("[earnings:withdraw] failed", err);
      setWithdrawStatus({
        type: "error",
        message: "Failed to withdraw tokens",
      });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Earnings</h1>

      {/* Wallet Balance Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex items-center gap-2 text-zinc-400">
            <Coins className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              $SWTD Balance
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold text-zinc-100">
            {swtdLoading ? "Loading..." : `${formatTokenBalance(swtdBalance)} $SWTD`}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex items-center gap-2 text-zinc-400">
            <Wallet className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              USDC Balance
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold text-zinc-100">
            {walletLoading ? "Loading..." : `${formatTokenBalance(usdcBalance)} USDC`}
          </p>
        </div>
      </div>

      {/* Withdraw Section */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Withdraw Tokens
        </h2>
        <div className="mt-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          <button
            type="button"
            onClick={() => setWithdrawStep(1)}
            className={withdrawStep === 1 ? "text-zinc-100" : "text-zinc-500"}
          >
            1. Select Token
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={() => setWithdrawStep(2)}
            className={withdrawStep === 2 ? "text-zinc-100" : "text-zinc-500"}
          >
            2. Destination
          </button>
        </div>

        {withdrawStep === 1 ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              {(["USDC", "SWTD"] as WithdrawToken[]).map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => setWithdrawToken(token)}
                  className={`rounded-sm border px-4 py-2 text-sm font-medium transition-colors ${
                    withdrawToken === token
                      ? "border-red-500 bg-red-500/10 text-red-400"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {token === "SWTD" ? "$SWTD" : "USDC"}
                </button>
              ))}
            </div>
            <p className="text-sm text-zinc-400">
              Available balance:{" "}
              <span className="font-semibold text-zinc-100">
                {selectedBalanceLoading
                  ? "Loading..."
                  : `${formatTokenBalance(selectedBalance)} ${
                      withdrawToken === "SWTD" ? "$SWTD" : "USDC"
                    }`}
              </span>
            </p>
            <Button onClick={() => setWithdrawStep(2)}>Continue</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Selected Token
              </p>
              <p className="mt-1 text-sm text-zinc-100">
                {withdrawToken === "SWTD" ? "$SWTD" : "USDC"}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Destination Wallet
              </label>
              <Input
                type="text"
                placeholder="Enter destination wallet address"
                value={destinationWalletAddress}
                onChange={(e) => setDestinationWalletAddress(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Withdraw Amount
              </label>
              <Input
                type="number"
                min={0}
                step="any"
                placeholder={`Amount in ${withdrawToken === "SWTD" ? "$SWTD" : "USDC"}`}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="max-w-[240px]"
              />
            </div>
            <p className="text-sm text-zinc-400">
              Available balance:{" "}
              <span className="font-semibold text-zinc-100">
                {selectedBalanceLoading
                  ? "Loading..."
                  : `${selectedBalance ?? "0"} ${withdrawToken === "SWTD" ? "$SWTD" : "USDC"}`}
              </span>
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWithdrawStep(1)}
              >
                Back
              </Button>
              <Button
                onClick={handleWithdraw}
                disabled={
                  withdrawing ||
                  !withdrawAmount ||
                  !destinationWalletAddress.trim()
                }
              >
                {withdrawing ? "Processing..." : "Withdraw"}
              </Button>
            </div>
          </div>
        )}

        {withdrawStatus && (
          <p
            className={`mt-2 text-sm ${
              withdrawStatus.type === "success"
                ? "text-emerald-400"
                : "text-red-400"
            }`}
          >
            {withdrawStatus.message}
          </p>
        )}
      </div>

      {/* Transaction Log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Transaction History
        </h2>

        {tipHistory === undefined ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-zinc-800/50"
              />
            ))}
          </div>
        ) : tipHistory.length === 0 ? (
          <div className="mt-8 flex flex-col items-center justify-center py-8 text-center">
            <Coins className="size-10 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-400">No transactions yet</p>
            <p className="mt-1 text-xs text-zinc-500">
              Tips you send and receive will appear here.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {tipHistory.map((tx) => (
              <li
                key={tx._id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    tx.direction === "received"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-orange-500/10 text-orange-400"
                  }`}
                >
                  {tx.direction === "received" ? (
                    <ArrowDownLeft className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-zinc-200">
                      {tx.direction === "received"
                        ? `From ${tx.counterpartyUsername}`
                        : `To ${tx.counterpartyUsername}`}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatDate(tx.createdAt)}
                    </span>
                  </div>
                  {tx.message && (
                    <p className="mt-0.5 truncate text-xs text-zinc-400">
                      {tx.message}
                    </p>
                  )}
                </div>

                <span
                  className={`shrink-0 text-sm font-semibold ${
                    tx.direction === "received"
                      ? "text-emerald-400"
                      : "text-orange-400"
                  }`}
                >
                  {tx.direction === "received" ? "+" : "-"}
                  {tx.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
