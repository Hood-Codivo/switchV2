"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useConvex, useQuery } from "convex/react";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import {
  Search,
  ChevronDown,
  User,
  Video,
  Copy,
  Settings,
  Plus,
  ArrowDownUp,
} from "lucide-react";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { usePlatformWallet } from "@/hooks/use-platform-wallet";
import {
  fetchSolBalance,
  fetchWalletMintBalance,
  getPlatformWalletConfig,
  truncateAddress,
} from "@/lib/solana/platform-wallet";
import { SWITCHED_TOKEN_MINT } from "@/lib/solana/tokens";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function HeaderSearch() {
  return (
    <div className="relative hidden w-full max-w-[380px] sm:flex">
      <input
        type="text"
        placeholder="Search"
        className="h-9 w-full rounded-l-full border border-zinc-700 bg-zinc-900 pl-4 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
      />
      <button className="flex h-9 items-center justify-center rounded-r-full border border-l-0 border-zinc-700 bg-red-500 px-3.5 text-white transition-colors hover:bg-red-600">
        <Search className="size-4" />
      </button>
    </div>
  );
}

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet";

function decodeBase64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function encodeBytesToBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

function formatTokenAmount(value?: string | null) {
  const amount = Number(value ?? "0");
  if (!Number.isFinite(amount)) return "0.000";
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function BuySwtdDropdown() {
  const [usdcAmount, setUsdcAmount] = useState("");
  const [quoteAmount, setQuoteAmount] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const currentUser = useQuery(api.users.getCurrentUser, {});
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
  const quoteBuySwtd = useAction(api.serverPlatformWallet.quoteBuySwtd);
  const prepareBuySwtdSwap = useAction(
    api.serverPlatformWallet.prepareBuySwtdSwap,
  );
  const prepareBuySwtdMeteoraSwap = useAction(
    api.serverPlatformWallet.prepareBuySwtdMeteoraSwap,
  );
  const submitBuySwtdSwap = useAction(
    api.serverPlatformWallet.submitBuySwtdSwap,
  );

  useEffect(() => {
    if (!usdcAmount) {
      setQuoteAmount(null);
      setError(null);
      return;
    }

    const amount = Number(usdcAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setQuoteAmount(null);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setQuoting(true);
        const inputAmountBaseUnits = BigInt(Math.round(amount * 10 ** 6));
        const quote = await quoteBuySwtd({
          inputAmountBaseUnits: inputAmountBaseUnits.toString(),
        });
        setQuoteAmount(quote.outputUiAmount);
      } catch (err) {
        console.error("[buy-swtd:quote] failed", err);
        setQuoteAmount(null);
      } finally {
        setQuoting(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [quoteBuySwtd, usdcAmount]);

  async function handleBuy() {
    const amount = Number(usdcAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSuccess(null);
      setError("Failed to buy $SWTD");
      return;
    }

    const walletAddress = currentUser?.walletAddress;
    const embeddedWallet = walletAddress
      ? solanaWallets.find((wallet) => wallet.address === walletAddress)
      : null;

    if (!walletAddress || !embeddedWallet) {
      setSuccess(null);
      setError("Failed to buy $SWTD");
      return;
    }

    setBuying(true);
    setError(null);
    setSuccess(null);

    try {
      const config = getPlatformWalletConfig();
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

      const platformWalletBalance = await fetchWalletMintBalance(
        walletSetup.platformWalletPda,
        config.usdcMint,
      );
      const inputAmountBaseUnits = BigInt(Math.round(amount * 10 ** 6));
      const preWithdrawUsdcBalance = await fetchWalletMintBalance(
        walletAddress,
        config.usdcMint,
      );
      const preSwapSolBalance = await fetchSolBalance(walletAddress);

      if (inputAmountBaseUnits <= BigInt(0)) {
        throw new Error("Invalid swap amount");
      }

      if (BigInt(platformWalletBalance.amount) < inputAmountBaseUnits) {
        throw new Error("Insufficient USDC balance");
      }

      const preparedWithdrawal = await prepareWithdrawToken({
        token: "USDC",
        amount,
        destinationWalletAddress: walletAddress,
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

      const withdrawDeadline = Date.now() + 20_000;
      let actualCreditedUsdcBaseUnits = BigInt(0);

      while (Date.now() < withdrawDeadline) {
        const postWithdrawUsdcBalance = await fetchWalletMintBalance(
          walletAddress,
          config.usdcMint,
        );
        actualCreditedUsdcBaseUnits =
          BigInt(postWithdrawUsdcBalance.amount) -
          BigInt(preWithdrawUsdcBalance.amount);

        if (actualCreditedUsdcBaseUnits > BigInt(0)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (actualCreditedUsdcBaseUnits <= BigInt(0)) {
        throw new Error("No USDC was credited to the wallet after withdrawal");
      }

      const preparedSwap = await prepareBuySwtdSwap({
        inputAmountBaseUnits: actualCreditedUsdcBaseUnits.toString(),
      });

      const signedSwap = await signTransaction({
        wallet: embeddedWallet,
        chain: solanaChain,
        transaction: decodeBase64ToBytes(preparedSwap.transactionBase64),
      });
      await submitBuySwtdSwap({
        signedTransactionBase64: encodeBytesToBase64(
          signedSwap.signedTransaction,
        ),
      });

      const deadline = Date.now() + 20_000;
      let actualCreditedLamports = BigInt(0);

      while (Date.now() < deadline) {
        const postSwapSolBalance = await fetchSolBalance(walletAddress);
        actualCreditedLamports =
          BigInt(postSwapSolBalance.lamports) -
          BigInt(preSwapSolBalance.lamports);

        if (actualCreditedLamports > BigInt(0)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (actualCreditedLamports <= BigInt(0)) {
        throw new Error("No SOL was credited to the wallet after USDC swap");
      }

      const preparedMeteoraSwap = await prepareBuySwtdMeteoraSwap({
        inputAmountLamports: actualCreditedLamports.toString(),
      });
      setQuoteAmount(preparedMeteoraSwap.outputUiAmount);

      const signedMeteoraSwap = await signTransaction({
        wallet: embeddedWallet,
        chain: solanaChain,
        transaction: decodeBase64ToBytes(preparedMeteoraSwap.transactionBase64),
      });

      await submitBuySwtdSwap({
        signedTransactionBase64: encodeBytesToBase64(
          signedMeteoraSwap.signedTransaction,
        ),
      });

      setSuccess("Successfully bought $SWTD");
    } catch (err) {
      console.error("[buy-swtd] failed", err);
      setError("Failed to buy $SWTD");
    } finally {
      setBuying(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative flex size-9 items-center justify-center rounded-full border border-zinc-700 transition-colors hover:border-zinc-500">
        <Plus className="size-4 text-zinc-300" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" sideOffset={8}>
        <div className="px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
              <ArrowDownUp className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Buy $SWTD</p>
              <p className="text-xs text-zinc-500">
                Swap USDC for switched token
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              You Pay
            </p>
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3">
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                value={usdcAmount}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (/^\d*\.?\d*$/.test(nextValue)) {
                    setUsdcAmount(nextValue);
                  }
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-semibold text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <div className="shrink-0 rounded-full border border-zinc-700 px-3 py-1 text-sm font-medium text-zinc-200">
                USDC
              </div>
            </div>

            <div className="my-3 flex justify-center">
              <div className="flex size-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
                <ArrowDownUp className="size-3.5" />
              </div>
            </div>

            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              You Receive
            </p>
            <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold text-zinc-100">
                    {quoting ? "..." : quoteAmount ? formatTokenAmount(quoteAmount) : "-"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Estimated output after SOL route
                  </p>
                </div>
                <div className="shrink-0 rounded-full border border-zinc-700 px-3 py-1 text-sm font-medium text-zinc-200">
                  $SWTD
                </div>
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            {success && <p className="mt-3 text-xs text-emerald-400">{success}</p>}

            <button
              type="button"
              onClick={handleBuy}
              disabled={buying || !usdcAmount}
              className="mt-4 w-full rounded-full bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {buying ? "Buying..." : "Buy $SWTD"}
            </button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileDropdown() {
  const router = useRouter();
  const { logout } = usePrivy();
  const convex = useConvex();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const { details, usdcBalance, loading, error } = usePlatformWallet(
    currentUser?.walletAddress,
  );
  const avatarSrc = currentUser?.avatarUrl ?? null;
  const initial = (currentUser?.username ?? "?")[0]?.toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full border border-zinc-700 py-1 pl-1 pr-2.5 transition-colors hover:border-zinc-500">
        <div className="size-7 shrink-0 overflow-hidden rounded-full bg-zinc-700">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs font-semibold text-zinc-300">
              {initial}
            </span>
          )}
        </div>
        <span className="hidden text-sm font-medium text-zinc-200 md:inline">
          {currentUser?.username ?? ""}
        </span>
        <ChevronDown className="size-3.5 text-zinc-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
            Platform Wallet
          </p>
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-500">USDC balance</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">
                  {loading ? "Loading..." : `${usdcBalance ?? "0"} USDC`}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-zinc-500">Platform wallet</p>
                    <p className="truncate text-sm text-zinc-200">
                      {details
                        ? truncateAddress(details.platformWalletPda, 6, 6)
                        : "Unavailable"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!details}
                    onClick={async () => {
                      if (!details) return;
                      await navigator.clipboard.writeText(
                        details.platformWalletPda,
                      );
                    }}
                    className="rounded-md border border-zinc-800 p-2 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Copy platform wallet PDA"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-white p-2">
                {details ? (
                  <QRCode
                    value={details.platformWalletPda}
                    size={92}
                    bgColor="#ffffff"
                    fgColor="#09090b"
                  />
                ) : (
                  <div className="flex size-[92px] items-center justify-center text-center text-[11px] text-zinc-500">
                    Wallet unavailable
                  </div>
                )}
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/studio")}>
          <Video className="mr-2 size-4" />
          Stream Studio
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push(`/${currentUser?.username}`)}
        >
          <User className="mr-2 size-4" />
          My Channel
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push("/dashboard/settings/profile")}
        >
          <Settings className="mr-2 size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-400 focus:text-red-400"
          onClick={async () => {
            try {
              await logout();
            } finally {
              convex.clearAuth();
              router.replace("/sign-in");
            }
          }}
        >
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeader() {
  const { ready, authenticated: isAuthenticated } = usePrivy();
  const isLoading = !ready;
  const router = useRouter();

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border/60 bg-background px-4 backdrop-blur-md">
      {/* Logo */}
      <Link href="/" className="shrink-0">
        <Image
          src="/switched-logo.svg"
          alt="Switched"
          width={110}
          height={22}
          className="hidden md:block"
          priority
        />
        <Image
          src="/switched-logo-mobile.svg"
          alt="Switched"
          width={24}
          height={24}
          className="block md:hidden"
          priority
        />
      </Link>

      {/* Search */}
      <HeaderSearch />

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {isLoading ? (
          <div className="size-7 animate-pulse rounded-full bg-zinc-800" />
        ) : isAuthenticated ? (
          <>
            <Button
              size="sm"
              onClick={() => router.push("/studio")}
              className="rounded-full bg-red-500 px-4 text-xs font-semibold text-white hover:bg-red-600"
            >
              Go Live
              <ChevronDown className="ml-1 size-3" />
            </Button>
            <BuySwtdDropdown />
            <NotificationBell />
            <ProfileDropdown />
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push("/sign-in")}
            className="rounded-full px-5 text-xs"
          >
            Login
          </Button>
        )}
      </div>
    </header>
  );
}
