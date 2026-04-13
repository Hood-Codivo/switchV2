"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  LogOut,
  MessageCircle,
  MessageSquare,
  Plus,
  Radio,
  Send,
  UserMinus,
  Users,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { STUDIO_LAYOUTS } from "@/lib/studio-layouts";
import type {
  StudioSource,
  StudioDevice,
  StudioGuest,
} from "@/hooks/use-studio";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  GoLiveState,
  StreamHealth,
  StreamSessionPlan,
  SimulcastOptions,
} from "@/hooks/use-go-live";
import type { StreamCategory } from "@/convex/schema";
import { StudioBottomBar } from "./studio-bottom-bar";
import { StudioLayoutCanvas } from "./studio-layout-canvas";
import { GoLiveModal } from "./go-live-modal";
import { StudioCommentsPanel } from "@/components/stream/stream-chat-panel";
import { StreamHealthIndicator } from "./stream-health-indicator";

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet";

function formatRemainingMinutes(value: number) {
  const safeValue = Math.max(0, value);
  if (safeValue >= 60) {
    const hours = Math.floor(safeValue / 60);
    const minutes = Math.ceil(safeValue % 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (safeValue >= 10) return `${Math.ceil(safeValue)}m`;
  return `${safeValue.toFixed(1)}m`;
}

function getGraceCountdown(graceStartedAt: number | null) {
  if (!graceStartedAt) return 0;
  const remainingMs = Math.max(0, graceStartedAt + 60_000 - Date.now());
  return Math.ceil(remainingMs / 1000);
}

function formatElapsedTime(startedAt: number | null | undefined) {
  if (!startedAt) return "0m";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

function decodeBase64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function encodeBytesToBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

// ─── Layout thumbnail ─────────────────────────────────────────────────────────

const LAYOUT_SVGS: Record<string, (c: string) => React.ReactNode> = {
  solo: (c) => (
    <rect x="1" y="1" width="26" height="16" rx="1.5" fill={c} opacity="0.75" />
  ),
  "side-by-side": (c) => (
    <>
      <rect
        x="1"
        y="1"
        width="12"
        height="16"
        rx="1.5"
        fill={c}
        opacity="0.75"
      />
      <rect
        x="15"
        y="1"
        width="12"
        height="16"
        rx="1.5"
        fill={c}
        opacity="0.75"
      />
    </>
  ),
  spotlight: (c) => (
    <>
      <rect
        x="1"
        y="1"
        width="18"
        height="16"
        rx="1.5"
        fill={c}
        opacity="0.75"
      />
      <rect x="21" y="1" width="6" height="7" rx="1" fill={c} opacity="0.5" />
      <rect x="21" y="10" width="6" height="7" rx="1" fill={c} opacity="0.5" />
    </>
  ),
  grid: (c) => (
    <>
      <rect x="1" y="1" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      <rect x="15" y="1" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      <rect x="1" y="10" width="12" height="7" rx="1" fill={c} opacity="0.75" />
      <rect
        x="15"
        y="10"
        width="12"
        height="7"
        rx="1"
        fill={c}
        opacity="0.75"
      />
    </>
  ),
  "pip-br": (c) => (
    <>
      <rect
        x="1"
        y="1"
        width="26"
        height="16"
        rx="1.5"
        fill={c}
        opacity="0.35"
      />
      <rect x="17" y="10" width="9" height="6" rx="1" fill={c} opacity="0.9" />
    </>
  ),
  "pip-bl": (c) => (
    <>
      <rect
        x="1"
        y="1"
        width="26"
        height="16"
        rx="1.5"
        fill={c}
        opacity="0.35"
      />
      <rect x="2" y="10" width="9" height="6" rx="1" fill={c} opacity="0.9" />
    </>
  ),
  "sidebar-r": (c) => (
    <>
      <rect
        x="1"
        y="1"
        width="17"
        height="16"
        rx="1.5"
        fill={c}
        opacity="0.75"
      />
      <rect x="20" y="1" width="7" height="4.5" rx="1" fill={c} opacity="0.5" />
      <rect
        x="20"
        y="6.75"
        width="7"
        height="4.5"
        rx="1"
        fill={c}
        opacity="0.5"
      />
      <rect
        x="20"
        y="12.5"
        width="7"
        height="4.5"
        rx="1"
        fill={c}
        opacity="0.5"
      />
    </>
  ),
  fullscreen: (c) => (
    <rect x="0" y="0" width="28" height="18" rx="1.5" fill={c} opacity="0.75" />
  ),
};

function LayoutThumb({
  id,
  label,
  active,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const svgFn = LAYOUT_SVGS[id];
  if (!svgFn) return null;
  const color = active ? "white" : "#71717a";
  return (
    <button
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-11 items-center justify-center rounded transition-all",
        active ? "bg-zinc-700 ring-1 ring-zinc-500" : "hover:bg-zinc-800",
      )}
    >
      <svg viewBox="0 0 28 18" className="h-4 w-[28px]" fill="none">
        {svgFn(color)}
      </svg>
    </button>
  );
}

// ─── Sidebar empty state ──────────────────────────────────────────────────────

type SidebarTab = "comments" | "chat" | "people";

function SidebarEmpty({ tab }: { tab: SidebarTab }) {
  const config = {
    comments: {
      icon: <MessageSquare className="size-8 text-zinc-700" />,
      title: "Comments",
      body: "Viewer comments appear here once you go live.",
    },
    chat: {
      icon: <MessageCircle className="size-8 text-zinc-700" />,
      title: "Private Chat",
      body: "Backstage chat with your guests.",
    },
    people: {
      icon: <Users className="size-8 text-zinc-700" />,
      title: "People",
      body: "Guests will appear here after joining via invite.",
    },
  }[tab];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {config.icon}
      <div>
        <p className="text-sm font-medium text-zinc-500">{config.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-700">
          {config.body}
        </p>
      </div>
    </div>
  );
}

// ─── People panel ─────────────────────────────────────────────────────────────

function PeoplePanel({
  guests,
  generateInviteLink,
  admitGuest,
  rejectGuest,
  removeGuest,
}: {
  guests: StudioGuest[];
  generateInviteLink: () => Promise<string>;
  admitGuest: (guestId: Id<"studioGuests">) => Promise<void>;
  rejectGuest: (guestId: Id<"studioGuests">) => void;
  removeGuest: (guestId: Id<"studioGuests">) => void;
}) {
  const [copied, setCopied] = useState(false);

  const waitingGuests = guests.filter((g) => g.status === "waiting");
  const admittedGuests = guests.filter((g) => g.status === "admitted");

  async function handleCopyLink() {
    const link = await generateInviteLink();
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <button
        onClick={() => void handleCopyLink()}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-600 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
      >
        {copied ? (
          <Check className="size-4 text-green-400" />
        ) : (
          <Copy className="size-4" />
        )}
        {copied ? "Link copied!" : "Copy invite link"}
      </button>

      {waitingGuests.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            Waiting
          </p>
          <div className="space-y-2">
            {waitingGuests.map((g) => (
              <div
                key={g._id}
                className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2"
              >
                <span className="text-sm text-zinc-300">{g.displayName}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void admitGuest(g._id)}
                    className="rounded bg-green-600/20 px-2 py-1 text-[10px] font-semibold text-green-400 hover:bg-green-600/30"
                  >
                    Admit
                  </button>
                  <button
                    onClick={() => rejectGuest(g._id)}
                    className="rounded bg-red-600/20 px-2 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-600/30"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {admittedGuests.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            In studio
          </p>
          <div className="space-y-2">
            {admittedGuests.map((g) => (
              <div
                key={g._id}
                className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-green-500" />
                  <span className="text-sm text-zinc-300">{g.displayName}</span>
                </div>
                <button
                  onClick={() => removeGuest(g._id)}
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                  title="Remove from studio"
                >
                  <UserMinus className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {guests.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Users className="size-8 text-zinc-700" />
          <div>
            <p className="text-sm font-medium text-zinc-500">People</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-700">
              Share the invite link to bring guests into your studio.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Backstage chat panel ─────────────────────────────────────────────────────

function BackstageChatPanel({
  sessionId,
  guestId,
}: {
  sessionId: Id<"studioSessions">;
  guestId?: Id<"studioGuests">;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useQuery(api.backstageChat.listBackstageMessages, {
    sessionId,
    guestId,
  });
  const sendMessage = useMutation(api.backstageChat.sendBackstageMessage);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await sendMessage({ sessionId, content, guestId });
  }

  if (messages === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageCircle className="size-8 text-zinc-700" />
            <div>
              <p className="text-sm font-medium text-zinc-500">Private Chat</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700">
                Backstage chat with your guests.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg._id} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-zinc-500">
                {msg.senderName}
                {msg.senderType === "creator" && (
                  <span className="ml-1 text-zinc-600">(host)</span>
                )}
              </span>
              <p className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200">
                {msg.content}
              </p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-zinc-800 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message…"
          className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!draft.trim()}
          className="flex items-center justify-center rounded-lg bg-zinc-700 px-3 text-zinc-300 transition-colors hover:bg-zinc-600 disabled:opacity-40"
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── StudioConnected ──────────────────────────────────────────────────────────

type StudioConnectedProps = {
  // compositorStream is gone — StudioLayoutCanvas owns it now.
  // Instead we accept an optional callback so use-studio can still
  // get the stream for meeting.self.setVideoTrack().
  onCompositorStream?: (stream: MediaStream | null) => void;
  sessionId: Id<"studioSessions">;
  guestId?: Id<"studioGuests">;
  sources: StudioSource[];
  onCanvasSlots: (StudioSource | null)[];
  activeLayoutId: string;
  cameras: StudioDevice[];
  microphones: StudioDevice[];
  toggleVideo: () => Promise<void>;
  toggleAudio: () => Promise<void>;
  switchCamera: (deviceId: string) => Promise<void>;
  switchMicrophone: (deviceId: string) => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  toggleSourceOnCanvas: (sourceId: string) => void;
  switchLayout: (layoutId: string) => void;
  endSession: () => Promise<void>;
  guests: StudioGuest[];
  generateInviteLink: () => Promise<string>;
  admitGuest: (guestId: Id<"studioGuests">) => Promise<void>;
  rejectGuest: (guestId: Id<"studioGuests">) => void;
  removeGuest: (guestId: Id<"studioGuests">) => void;
  liveState: GoLiveState;
  viewerCount: number;
  health: StreamHealth | null;
  onGoLive: (
    title: string,
    category: StreamCategory,
    sessionPlan: StreamSessionPlan,
    simulcast?: SimulcastOptions,
  ) => Promise<void>;
  onEndStream: () => Promise<void>;
  isHost: boolean;
};

export function StudioConnected({
  onCompositorStream,
  sessionId,
  guestId,
  sources,
  onCanvasSlots,
  activeLayoutId,
  cameras,
  microphones,
  toggleVideo,
  toggleAudio,
  switchCamera,
  switchMicrophone,
  toggleScreenShare,
  toggleSourceOnCanvas,
  switchLayout,
  endSession,
  guests,
  generateInviteLink,
  admitGuest,
  rejectGuest,
  removeGuest,
  liveState,
  viewerCount,
  health,
  onGoLive,
  onEndStream,
  isHost,
}: StudioConnectedProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("people");
  const [modalOpen, setModalOpen] = useState(false);
  const [topUpMenuOpen, setTopUpMenuOpen] = useState(false);
  const [topUpLoadingMinutes, setTopUpLoadingMinutes] = useState<number | null>(
    null,
  );

  // Query the active stream for the Comments panel (public chat feed)
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const prepareStreamTopUpCharge = useAction(
    api.serverPlatformWallet.prepareStreamTopUpCharge,
  );
  const submitStreamTopUpCharge = useAction(
    api.serverPlatformWallet.submitStreamTopUpCharge,
  );
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const activeStream = useQuery(
    api.streams.getActive,
    currentUser?._id ? { userId: currentUser._id } : "skip",
  );
  const activeBillingStatus = useQuery(
    api.streams.getActiveBillingStatus,
    isHost ? {} : "skip",
  );

  const approvedRemaining = activeBillingStatus?.remainingApprovedMinutes ?? 0;
  const graceCountdown = getGraceCountdown(
    activeBillingStatus?.graceStartedAt ?? null,
  );
  const billingState = activeBillingStatus?.billingState;
  const elapsedTime = formatElapsedTime(activeStream?.startedAt ?? null);

  const warningMessage =
    liveState === "live" && billingState === "active" && approvedRemaining <= 1
      ? "Less than 1 minute of approved time remaining"
      : liveState === "live" &&
          billingState === "active" &&
          approvedRemaining <= 5
        ? "5 minutes of approved time remaining"
        : liveState === "live" &&
            billingState === "active" &&
            approvedRemaining <= 15
          ? "15 minutes of approved time remaining"
                : null;

  const warningTone =
    billingState === "grace" || billingState === "exhausted"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : warningMessage
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-zinc-500/20 bg-zinc-800 text-white-200";

  const billingStatusLabel =
    billingState === "grace"
      ? `Top up within ${graceCountdown}s`
      : billingState === "exhausted"
        ? "Session exhausted"
          : (warningMessage ?? "Streaming on approved spend");
  const showTopUpButton =
    liveState === "live" &&
    (billingState === "grace" ||
      (billingState === "active" && approvedRemaining <= 15));
  const topUpOptions: StreamSessionPlan["plannedMinutes"][] = [
    30, 60, 120, 180, 300,
  ];

  function handleCompositorStream(stream: MediaStream | null) {
    onCompositorStream?.(stream);
  }

  async function handleTopUpPurchase(
    purchasedMinutes: StreamSessionPlan["plannedMinutes"],
  ) {
    const walletAddress = currentUser?.walletAddress;
    const embeddedWallet = walletAddress
      ? solanaWallets.find((wallet) => wallet.address === walletAddress)
      : null;

    if (!walletAddress || !embeddedWallet) {
      throw new Error("Wallet not ready yet. Please try again.");
    }

    setTopUpLoadingMinutes(purchasedMinutes);
    try {
      const prepared = await prepareStreamTopUpCharge({ purchasedMinutes });
      const signedTransaction = await signTransaction({
        wallet: embeddedWallet,
        chain: solanaChain,
        transaction: decodeBase64ToBytes(prepared.transactionBase64),
      });

      await submitStreamTopUpCharge({
        purchasedMinutes,
        signedTransactionBase64: encodeBytesToBase64(
          signedTransaction.signedTransaction,
        ),
      });

      setTopUpMenuOpen(false);
    } catch (error) {
      console.error("[stream-topup] failed", error);
    } finally {
      setTopUpLoadingMinutes(null);
    }
  }

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-zinc-950 text-white">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900">
        <header className="flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Studio</span>
            <div className="h-3.5 w-px bg-zinc-700" />
            {liveState === "idle" && (
              <span className="text-xs text-zinc-500">Not live</span>
            )}
            {liveState === "starting" && (
              <span className="text-xs text-zinc-500">Starting…</span>
            )}
            {liveState === "live" && (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs font-bold text-red-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                  LIVE
                </span>
                <div className="flex items-center gap-1 text-xs text-zinc-400">
                  <Users className="size-3" />
                  {viewerCount}
                </div>
                {health !== null && <StreamHealthIndicator health={health} />}
                {activeBillingStatus && (
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span>
                      Elapsed:{" "}
                      <span className="text-zinc-200">{elapsedTime}</span>
                    </span>
                    <div className="relative flex items-center gap-2">
                      <span>
                        Approved:{" "}
                        <span className="text-zinc-200">
                          {formatRemainingMinutes(approvedRemaining)}
                        </span>
                      </span>
                      {showTopUpButton && (
                        <>
                          <button
                            onClick={() => setTopUpMenuOpen((open) => !open)}
                            className="flex size-6 items-center justify-center rounded border border-zinc-700 bg-white text-black transition-colors hover:bg-zinc-200"
                            title="Buy more stream time"
                          >
                            <Plus className="size-3.5" />
                          </button>
                          {topUpMenuOpen && (
                            <div className="absolute left-0 top-8 z-20 w-52 rounded-lg border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
                              <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                                Buy More Time
                              </p>
                              <div className="space-y-1">
                                {topUpOptions.map((minutes) => (
                                  <button
                                    key={minutes}
                                    onClick={() =>
                                      void handleTopUpPurchase(minutes)
                                    }
                                    disabled={topUpLoadingMinutes !== null}
                                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <span>
                                      {formatRemainingMinutes(minutes)}
                                    </span>
                                    <span className="text-[10px] text-zinc-500">
                                      {topUpLoadingMinutes === minutes
                                        ? "Purchasing…"
                                        : "Extend"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        warningTone,
                      )}
                    >
                      {billingStatusLabel}
                    </span>
                  </div>
                )}
              </div>
            )}
            {liveState === "ending" && (
              <span className="text-xs text-zinc-500">Ending…</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {liveState === "idle" && isHost && (
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
              >
                <Radio className="size-3" />
                Go Live
              </button>
            )}
            {liveState === "starting" && (
              <button
                disabled
                className="flex cursor-not-allowed items-center gap-1.5 rounded bg-red-600/50 px-3 py-1.5 text-xs font-semibold text-red-300 opacity-70"
              >
                <Loader2 className="size-3 animate-spin" />
                Starting…
              </button>
            )}
            {liveState === "live" && (
              <button
                onClick={() => void onEndStream()}
                className="flex items-center gap-1.5 rounded bg-red-600/80 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
              >
                End Stream
              </button>
            )}
            {liveState === "ending" && (
              <button
                disabled
                className="flex cursor-not-allowed items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 opacity-70"
              >
                <Loader2 className="size-3 animate-spin" />
                Ending…
              </button>
            )}
            <button
              onClick={() => void endSession()}
              className="flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              <LogOut className="size-3" />
              Leave
            </button>
          </div>
        </header>
      </div>

      {/* ── Middle: canvas + sidebar ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Canvas column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Preview area */}
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="w-full max-w-4xl">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/5">
                {/*
                  StudioLayoutCanvas replaces CompositorPreview.
                  It renders the layout tiles as visible <video> elements AND
                  simultaneously composites them onto a hidden <canvas>, emitting
                  a MediaStream via onCompositorStream.
                */}
                <StudioLayoutCanvas
                  slots={onCanvasSlots}
                  layoutId={activeLayoutId}
                  onCompositorStream={handleCompositorStream}
                />
              </div>
            </div>
          </div>

          {/* Layout picker */}
          <div className="flex h-12 flex-shrink-0 items-center gap-1 border-t border-zinc-800 bg-zinc-900 px-4">
            <span className="mr-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
              Layout
            </span>
            {STUDIO_LAYOUTS.map((l) => (
              <LayoutThumb
                key={l.id}
                id={l.id}
                label={l.label}
                active={activeLayoutId === l.id}
                onClick={() => switchLayout(l.id)}
              />
            ))}
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="flex w-72 flex-shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
          <div className="flex border-b border-zinc-800">
            {(["comments", "chat", "people"] as SidebarTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium capitalize transition-colors",
                  activeTab === tab
                    ? "border-b-2 border-white text-white"
                    : "text-zinc-600 hover:text-zinc-400",
                )}
              >
                {tab === "comments" && <MessageSquare className="size-3.5" />}
                {tab === "chat" && <MessageCircle className="size-3.5" />}
                {tab === "people" && <Users className="size-3.5" />}
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "people" && (
            <PeoplePanel
              guests={guests}
              generateInviteLink={generateInviteLink}
              admitGuest={admitGuest}
              rejectGuest={rejectGuest}
              removeGuest={removeGuest}
            />
          )}
          {activeTab === "chat" && (
            <BackstageChatPanel sessionId={sessionId} guestId={guestId} />
          )}
          {activeTab === "comments" &&
            (activeStream?._id ? (
              <StudioCommentsPanel streamId={activeStream._id} />
            ) : (
              <SidebarEmpty tab="comments" />
            ))}
        </aside>
      </div>

      {/* ── Bottom strip ─────────────────────────────────────────────────── */}
      <StudioBottomBar
        sources={sources}
        onCanvasSlots={onCanvasSlots}
        cameras={cameras}
        microphones={microphones}
        toggleVideo={toggleVideo}
        toggleAudio={toggleAudio}
        switchCamera={switchCamera}
        switchMicrophone={switchMicrophone}
        toggleScreenShare={toggleScreenShare}
        toggleSourceOnCanvas={toggleSourceOnCanvas}
      />

      {/* ── Go Live modal ────────────────────────────────────────────────── */}
      {isHost && (
        <GoLiveModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={async (title, category, sessionPlan, simulcast) => {
            await onGoLive(title, category, sessionPlan, simulcast);
            setModalOpen(false);
          }}
          isStarting={liveState === "starting"}
        />
      )}
    </div>
  );
}
