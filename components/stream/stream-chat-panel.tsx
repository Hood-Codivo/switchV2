"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { MessageCircle, UsersRound, Smile, Send, Ban, Clock, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

type StreamChatPanelProps = {
  streamId: Id<"streams">
  creatorId: Id<"users">
  isCreator: boolean
}

export function StreamChatPanel({ streamId, creatorId, isCreator }: StreamChatPanelProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "participants">("chat")

  return (
    <div className="flex h-full flex-col border border-border/65 bg-card">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("chat")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
            activeTab === "chat"
              ? "border-b-2 border-red-500 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          <MessageCircle className="size-4" />
          Stream Chat
        </button>
        <button
          onClick={() => setActiveTab("participants")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 py-3 text-sm transition-colors",
            activeTab === "participants"
              ? "border-b-2 border-red-500 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          <UsersRound className="size-4" />
          Participants
        </button>
      </div>

      {activeTab === "chat" ? (
        <ChatTab streamId={streamId} creatorId={creatorId} isCreator={isCreator} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-xs text-zinc-600">Participants list coming soon</p>
        </div>
      )}
    </div>
  )
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({
  streamId,
  creatorId,
  isCreator,
}: {
  streamId: Id<"streams">
  creatorId: Id<"users">
  isCreator: boolean
}) {
  const messages = useQuery(api.chat.listMessages, { streamId })
  const moderationState = useQuery(api.chat.getModerationState, { streamId })
  const moderateUser = useMutation(api.chat.moderateUser)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll only when the user is near the bottom (within 100px).
  // This prevents force-scrolling viewers who scrolled up to read older messages.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 100) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages?.length])

  return (
    <>
      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {messages === undefined ? (
          <p className="py-8 text-center text-xs text-zinc-600">Loading chat…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-600">
            No messages yet — be the first to say something!
          </p>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg._id}
              username={msg.username}
              content={msg.content}
              isCreatorMessage={msg.userId === creatorId}
              showModeration={isCreator && msg.userId !== creatorId}
              onTimeout={() => moderateUser({ streamId, userId: msg.userId, action: "timeout", duration: 300 })}
              onBan={() => moderateUser({ streamId, userId: msg.userId, action: "ban" })}
            />
          ))
        )}
      </div>

      {/* Moderation feedback banner */}
      {moderationState?.banned && (
        <div className="border-t border-zinc-800 bg-red-950/50 px-4 py-2">
          <p className="text-xs text-red-400">You are banned from this chat.</p>
        </div>
      )}
      {moderationState?.timedOutUntil && !moderationState.banned && (
        <div className="border-t border-zinc-800 bg-yellow-950/50 px-4 py-2">
          <p className="text-xs text-yellow-400">
            You are timed out. Try again later.
          </p>
        </div>
      )}

      {/* Input */}
      <ChatInput
        streamId={streamId}
        disabled={!!moderationState?.banned || !!moderationState?.timedOutUntil}
        isCreator={isCreator}
      />
    </>
  )
}

// ─── Chat Message ─────────────────────────────────────────────────────────────

function ChatMessage({
  username,
  content,
  isCreatorMessage,
  showModeration,
  onTimeout,
  onBan,
}: {
  username: string
  content: string
  isCreatorMessage: boolean
  showModeration: boolean
  onTimeout: () => void
  onBan: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div
      className="group relative rounded px-1.5 py-1 hover:bg-zinc-800/50"
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
    >
      <p className="text-sm leading-snug">
        <span
          className={cn(
            "font-semibold",
            isCreatorMessage ? "text-red-400" : "text-emerald-400",
          )}
        >
          {username}
          {isCreatorMessage && (
            <span className="ml-1 rounded bg-red-500/20 px-1 py-px text-[10px] font-bold text-red-400">
              HOST
            </span>
          )}
        </span>
        {": "}
        <span className="text-zinc-300">{content}</span>
      </p>

      {/* Moderation menu (creator only, on hover) */}
      {showModeration && showMenu && (
        <div className="absolute right-1 top-0.5 flex gap-0.5 rounded border border-zinc-700 bg-zinc-900 p-0.5 shadow-lg">
          <button
            onClick={onTimeout}
            title="Timeout 5 min"
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-yellow-400"
          >
            <Clock className="size-3.5" />
          </button>
          <button
            onClick={onBan}
            title="Ban user"
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-red-400"
          >
            <Ban className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Chat Input ───────────────────────────────────────────────────────────────

function ChatInput({
  streamId,
  disabled,
  isCreator,
}: {
  streamId: Id<"streams">
  disabled: boolean
  isCreator: boolean
}) {
  const { isAuthenticated } = useConvexAuth()
  const router = useRouter()
  const sendMessage = useMutation(api.chat.sendMessage)
  const clearChat = useMutation(api.chat.clearChat)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return

    try {
      await sendMessage({ streamId, content: text })
      setText("")
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send")
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={() => router.push("/sign-in")}
          className="w-full rounded-full border border-zinc-700 bg-zinc-900 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
        >
          Sign in to chat
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-800 p-3">
      {error && (
        <p className="mb-2 text-xs text-red-400">{error}</p>
      )}

      <form onSubmit={handleSend} className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={disabled ? "You cannot chat right now" : "Send a message"}
            disabled={disabled}
            maxLength={500}
            className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
          />
          <Smile className="size-4 shrink-0 text-zinc-600" />
        </div>

        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="flex size-9 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600 disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>

      {/* Creator clear chat button */}
      {isCreator && (
        <button
          onClick={() => clearChat({ streamId })}
          className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-red-400"
        >
          <Trash2 className="size-3" />
          Clear chat
        </button>
      )}
    </div>
  )
}

// ─── Studio Comments Panel (read-only for creator) ────────────────────────────

export function StudioCommentsPanel({ streamId }: { streamId: Id<"streams"> }) {
  const messages = useQuery(api.chat.listMessages, { streamId })
  const moderateUser = useMutation(api.chat.moderateUser)
  const clearChat = useMutation(api.chat.clearChat)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 100) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages?.length])

  return (
    <div className="flex flex-1 flex-col">
      <div ref={scrollRef} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {messages === undefined ? (
          <p className="py-8 text-center text-xs text-zinc-600">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-600">
            Viewer comments appear here once they start chatting.
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg._id} className="group flex items-start justify-between gap-2 rounded px-1.5 py-1 hover:bg-zinc-800/50">
              <p className="min-w-0 text-sm leading-snug">
                <span className="font-semibold text-emerald-400">{msg.username}</span>
                {": "}
                <span className="text-zinc-300">{msg.content}</span>
              </p>
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => moderateUser({ streamId, userId: msg.userId, action: "timeout", duration: 300 })}
                  title="Timeout 5 min"
                  className="rounded p-1 text-zinc-500 hover:text-yellow-400"
                >
                  <Clock className="size-3" />
                </button>
                <button
                  onClick={() => moderateUser({ streamId, userId: msg.userId, action: "ban" })}
                  title="Ban user"
                  className="rounded p-1 text-zinc-500 hover:text-red-400"
                >
                  <Ban className="size-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-zinc-800 p-2">
        <button
          onClick={() => clearChat({ streamId })}
          className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-red-400"
        >
          <Trash2 className="size-3" />
          Clear all
        </button>
      </div>
    </div>
  )
}
