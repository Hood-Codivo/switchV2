"use client"

import { FormEvent, useMemo, useState, type ComponentType } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  KeyRound,
  Plus,
  Radio,
  Terminal,
  WalletCards,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ApiKeyId = Id<"infrastructureApiKeys">

function formatDate(value?: number | null) {
  if (!value) return "Not yet"
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === "live"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : status === "exhausted"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : status === "ended"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-border bg-muted text-muted-foreground"

  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs", classes)}>
      {status}
    </span>
  )
}

function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="h-28 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copyValue() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copyValue}>
      {copied ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  )
}

function CreateOrganizationForm() {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const createOrganization = useMutation(api.infrastructure.createOrganization)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Platform name is required")
      return
    }

    setPending(true)
    setError(null)
    try {
      await createOrganization({ name })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create platform")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <CableIcon />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Create your infrastructure workspace</h1>
          <p className="text-sm text-muted-foreground">
            This workspace owns API keys, streams, and pay-as-you-go tokens.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="platform-name" className="text-sm font-medium">
            Platform name
          </label>
          <Input
            id="platform-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="organization"
            placeholder="Acme Classes"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "platform-name-error" : "platform-name-help"}
          />
          {error ? (
            <p id="platform-name-error" className="text-xs text-destructive">
              {error}
            </p>
          ) : (
            <p id="platform-name-help" className="text-xs text-muted-foreground">
              Your first 100 infrastructure tokens are added automatically.
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          <Plus className="size-4" aria-hidden="true" />
          {pending ? "Creating..." : "Create workspace"}
        </Button>
      </form>
    </div>
  )
}

function CableIcon() {
  return <Terminal className="size-5 text-muted-foreground" aria-hidden="true" />
}

export default function InfrastructureDashboardPage() {
  const dashboard = useQuery(api.infrastructure.getDashboard, {})
  const purchaseTokens = useMutation(api.infrastructure.purchaseTokens)
  const createApiKey = useMutation(api.infrastructure.createApiKey)
  const revokeApiKey = useMutation(api.infrastructure.revokeApiKey)

  const [keyName, setKeyName] = useState("Production key")
  const [newKey, setNewKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const integrationSnippet = useMemo(() => {
    const apiKey = newKey ?? "sk_test_switched_your_key"
    return `const res = await fetch("https://your-switched-domain.com/api/infrastructure/v1/streams", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Live class",
    externalUserId: "teacher_123",
    externalStreamId: "class_456",
  }),
})

const { data } = await res.json()
// data.studioUrl -> send your host here
// data.viewerEmbedUrl -> iframe inside your platform`
  }, [newKey])

  if (dashboard === undefined) return <SkeletonDashboard />

  if (dashboard === null) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <h1 className="text-sm font-semibold">Sign in required</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to manage infrastructure billing and API access.
        </p>
      </div>
    )
  }

  if (!dashboard.organization) return <CreateOrganizationForm />

  const organization = dashboard.organization
  const activeKeys = dashboard.apiKeys.filter((key) => !key.revokedAt)
  const liveStreams = dashboard.streams.filter((stream) => stream.status === "live").length

  async function topUp(amount: number) {
    setPendingAction(`topup-${amount}`)
    setActionError(null)
    try {
      await purchaseTokens({ amount })
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not buy tokens")
    } finally {
      setPendingAction(null)
    }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction("create-key")
    setActionError(null)
    try {
      const result = await createApiKey({ name: keyName })
      setNewKey(result.key)
      setKeyName("Production key")
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not create API key")
    } finally {
      setPendingAction(null)
    }
  }

  async function revokeKey(id: ApiKeyId) {
    setPendingAction(`revoke-${id}`)
    setActionError(null)
    try {
      await revokeApiKey({ id })
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not revoke API key")
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Infrastructure workspace</p>
            <h1 className="mt-1 text-2xl font-semibold">{organization.name}</h1>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              Build live streaming into another product with Switched-hosted studio links,
              viewer embeds, API keys, and usage tokens.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Tokens" value={organization.tokenBalance.toLocaleString()} icon={WalletCards} />
            <Stat label="Live now" value={liveStreams.toLocaleString()} icon={Radio} />
            <Stat label="API keys" value={activeKeys.length.toLocaleString()} icon={KeyRound} />
          </div>
        </div>
      </section>

      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section id="billing" className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-semibold">Pay-as-you-go tokens</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            One live minute consumes one infrastructure token. When the balance reaches
            zero, API-created streams cannot start until the platform buys more.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {dashboard.topUpPacks.map((amount) => (
              <Button
                key={amount}
                type="button"
                variant="outline"
                className="min-h-16 flex-col"
                disabled={pendingAction === `topup-${amount}`}
                aria-busy={pendingAction === `topup-${amount}`}
                onClick={() => void topUp(amount)}
              >
                <span className="text-base font-semibold">{amount.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">
                  {pendingAction === `topup-${amount}` ? "Buying..." : "Buy tokens"}
                </span>
              </Button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-semibold">Ledger</h2>
          </div>
          <div className="mt-4 space-y-3">
            {dashboard.transactions.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                No token transactions yet.
              </p>
            ) : (
              dashboard.transactions.slice(0, 5).map((transaction) => (
                <div
                  key={transaction._id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{transaction.description}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(transaction.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-sm font-semibold", transaction.amount < 0 ? "text-red-300" : "text-emerald-300")}>
                      {transaction.amount > 0 ? "+" : ""}
                      {transaction.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {transaction.balanceAfter.toLocaleString()} left
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section id="api-keys" className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">API keys</h2>
        </div>
        <form onSubmit={createKey} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <label htmlFor="api-key-name" className="text-sm font-medium">
              Key name
            </label>
            <Input
              id="api-key-name"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button
            type="submit"
            className="self-end"
            disabled={pendingAction === "create-key"}
            aria-busy={pendingAction === "create-key"}
          >
            <Plus className="size-4" aria-hidden="true" />
            {pendingAction === "create-key" ? "Creating..." : "Create key"}
          </Button>
        </form>
        {newKey && (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-medium text-emerald-200">Copy this key now. It will not be shown again.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs">
                {newKey}
              </code>
              <CopyButton value={newKey} />
            </div>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {dashboard.apiKeys.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No API keys yet. Create one to let your backend call Switched.
            </p>
          ) : (
            dashboard.apiKeys.map((key) => (
              <div
                key={key._id}
                className="flex flex-col gap-3 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{key.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {key.keyPrefix}... · created {formatDate(key.createdAt)} · last used{" "}
                    {formatDate(key.lastUsedAt)}
                  </p>
                </div>
                {key.revokedAt ? (
                  <StatusPill status="revoked" />
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={pendingAction === `revoke-${key._id}`}
                    aria-busy={pendingAction === `revoke-${key._id}`}
                    onClick={() => void revokeKey(key._id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section id="streams" className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">Infrastructure streams</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          {dashboard.streams.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No infrastructure streams yet. Create one through the API and it will appear here.
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">Title</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Tokens</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium">Embed</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.streams.map((stream) => (
                  <tr key={stream.id} className="border-b border-border/60">
                    <td className="py-3">
                      <p className="font-medium">{stream.title}</p>
                      <p className="text-xs text-muted-foreground">{stream.externalStreamId ?? stream.id}</p>
                    </td>
                    <td className="py-3"><StatusPill status={stream.status} /></td>
                    <td className="py-3">{stream.tokenCost.toLocaleString()}</td>
                    <td className="py-3">{formatDate(stream.createdAt)}</td>
                    <td className="py-3">
                      <CopyButton value={stream.embedPath} label="Copy path" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section id="integration" className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">Integration starter</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Your backend creates streams. Your frontend redirects hosts to `studioUrl`
          and embeds `viewerEmbedUrl` for viewers.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <pre className="overflow-x-auto rounded-md border border-border bg-background p-4 text-xs leading-6 text-muted-foreground">
            <code>{integrationSnippet}</code>
          </pre>
          <div>
            <CopyButton value={integrationSnippet} label="Copy snippet" />
          </div>
        </div>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <div className="min-w-36 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}
