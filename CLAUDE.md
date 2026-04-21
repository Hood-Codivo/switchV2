# Project: Switched

<!-- cspell:ignore livestreaming Turbopack webrtc solana -->

## What This Is

Switched is a browser-based live streaming platform that combines a professional stream studio (like StreamYard) with a viewer community platform (like Twitch/Kick). Creators go live directly from their browser, invite guests via shareable links, choose from preset stream layouts, and simulcast to YouTube, X, and LinkedIn — all from a single tab. The platform is built creator-first with a roadmap toward a blockchain-based token economy on Solana.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4
- **Components**: shadcn/ui (base-vega style, dark theme)
- **Icons**: lucide-react
- **Backend / Database / Real-time**: Convex
- **Auth**: Convex Auth (Google OAuth)
- **Client Data Fetching**: TanStack Query v5
- **Studio WebRTC**: Cloudflare Realtime SFU
- **Stream Delivery**: Cloudflare Stream (HLS)
- **Simulcast**: Restream API
- **Package Manager**: pnpm

## Project Structure

- `app/` — Pages, layouts, and route handlers (Next.js App Router)
- `app/ui/` — shadcn-generated UI primitives (do not edit directly)
- `components/` — Feature components and shared UI built on top of shadcn primitives
- `hooks/` — Custom React hooks
- `lib/` — Utility functions, Convex client setup, and third-party configurations
- `convex/` — Convex schema, queries, mutations, actions, and scheduled functions
- `public/` — Static assets

## Commands

- `pnpm dev` — Start dev server with Turbopack
- `pnpm build` — Build for production
- `pnpm lint` — Run ESLint
- `pnpm format` — Format all files with Prettier
- `pnpm typecheck` — Run TypeScript type checking with no emit

## Coding Conventions

### TypeScript

- Strict mode is on — no `any` types, ever
- Prefer `type` over `interface` unless declaration merging is needed
- All Convex query/mutation arguments and return types must be explicitly typed

### Components

- Use server components by default; add `"use client"` only when the component requires browser APIs, event handlers, or React state
- **Do not pre-create components speculatively.** Create a component only when it is needed. If a component is used in one place, keep it in the same file as its parent — do not extract it into its own file until it is reused in a second place
- Functional components only — no class components
- Props types defined in the same file as the component, not in a separate types file

### Styling

- Tailwind CSS for all styling — no custom CSS files, no inline `style` props
- **All shadcn components must use the dark theme** — never render shadcn components on a light background
- Use `cn()` from `@/lib/utils` for conditional class merging
- Responsive design using Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`)

### shadcn

- Install new shadcn components with `pnpm dlx shadcn@latest add <component>` — never hand-write shadcn primitives
- shadcn primitives live in `app/ui/` — feature components that compose them live in `components/`
- Always pass the `dark` class context when using shadcn components inside a page

### Hooks and Side Effects

- **Do not use `useEffect` unless there is no alternative.** Before reaching for `useEffect`, consider: can this be derived state? Can this be a server component? Can Convex's real-time subscriptions handle this?
- Legitimate `useEffect` uses: integrating non-React third-party libraries (e.g., WebRTC, Canvas APIs), subscribing to browser events (resize, visibility change), cleanup of imperative resources
- Never use `useEffect` for data fetching — use Convex `useQuery` or TanStack Query instead
- Never use `useEffect` to sync state from props — derive it or lift it

### Convex

- Queries must be pure — no side effects in `query()` functions
- Use `mutation()` for all writes; never write to the database from a `query()`
- Use `action()` only for calls to external APIs (Cloudflare, Restream, Web Push)
- Scheduled functions (via `ctx.scheduler`) for fan-out operations like go-live notifications
- All Convex function files live in `convex/` — one file per domain (e.g., `convex/streams.ts`, `convex/chat.ts`)
- **Convex handles all real-time subscriptions** — never use TanStack Query to poll Convex data

### TanStack Query

TanStack Query is used **only for external REST API calls** (Cloudflare Stream API, Restream API, Web Push, etc.). It is not a replacement for Convex — they serve different purposes:

- **Convex `useQuery`** — real-time database subscriptions (chat, viewer count, notifications, stream status)
- **TanStack Query `useQuery`** — one-shot or periodically refreshed calls to external HTTP APIs

#### Key rules

- Wrap the app in `QueryClientProvider` at the root layout (client component)
- Define query keys as typed constants co-located with the query function, not inline
- Always provide a `staleTime` — never rely on the default (0ms); most external API data can be stale for at least 30 seconds
- Use `useMutation` from TanStack Query for external API writes (e.g., creating a Restream broadcast session); use Convex `mutation()` for database writes
- Do not use `queryClient.invalidateQueries` to invalidate Convex data — Convex handles its own invalidation via subscriptions
- Handle `isLoading`, `isError`, and `data` states explicitly in every component that uses `useQuery`
- Place query functions in `lib/queries/` — named after the external service (e.g., `lib/queries/restream.ts`, `lib/queries/cloudflare-stream.ts`)

#### Example pattern

```ts
// lib/queries/restream.ts
export const restreamKeys = {
  sessionStatus: (sessionId: string) => ["restream", "session", sessionId] as const,
}

export async function fetchSessionStatus(sessionId: string): Promise<RestreamSessionStatus> {
  const res = await fetch(`/api/restream/session/${sessionId}`)
  if (!res.ok) throw new Error("Failed to fetch session status")
  return res.json()
}

// In a component
const { data, isLoading, isError } = useQuery({
  queryKey: restreamKeys.sessionStatus(sessionId),
  queryFn: () => fetchSessionStatus(sessionId),
  staleTime: 30_000,
  refetchInterval: 10_000, // poll while live
})
```

### File Naming

- Files and directories: `kebab-case` (e.g., `stream-studio.tsx`, `use-webrtc.ts`)
- Convex function files: `kebab-case` matching their domain (e.g., `convex/chat-messages.ts`)
- Component files: `kebab-case` (e.g., `studio-canvas.tsx`)
- TanStack Query files: `lib/queries/<service-name>.ts`

### Error & Loading States

- Every data-fetching component must handle loading and error states explicitly — no bare renders assuming data is available
- Convex `useQuery`: check for `undefined` (loading) before rendering data
- TanStack Query `useQuery`: check `isLoading` and `isError` before rendering `data`

## Key Architecture Notes

- **The platform always receives the stream.** A creator cannot simulcast to external platforms without also being live on Switched. The Cloudflare Stream HLS URL is always the primary delivery mechanism.
- **Guest invite links do not require an account.** Guests join via `/studio/join/[token]` — they are session-scoped participants, not platform users.
- **Tips are fake points in Phase 1.** The `tipTransactions` schema includes nullable `solanaSignature` and `tokenMint` fields from day one to make the Phase 3 Solana migration additive, not a rewrite.
- **Private backstage chat is scoped to `studioSessionId`, not `streamId`.** Never query backstage messages using the public stream chat query.
- **TanStack Query is not a Convex replacement.** Use Convex for anything that lives in the database. Use TanStack Query only for external service calls that do not go through Convex.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
