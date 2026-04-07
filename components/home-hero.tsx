"use client"

import { useEffect, useRef } from "react"
import { Syne } from "next/font/google"
import Link from "next/link"
import { usePrivy } from "@privy-io/react-auth"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { getThumbnailUrl } from "@/lib/stream-thumbnail"
import { cn } from "@/lib/utils"

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
})

const MOSAIC_TILES = [
  { gradient: "from-purple-700 to-blue-600", rotation: "rotate-[2deg]" },
  { gradient: "from-orange-600 to-pink-700", rotation: "rotate-[-3deg]" },
  { gradient: "from-emerald-600 to-cyan-700", rotation: "rotate-[4deg]" },
  { gradient: "from-rose-600 to-violet-700", rotation: "rotate-[-2deg]" },
  { gradient: "from-amber-600 to-red-600", rotation: "rotate-[3deg]" },
  { gradient: "from-teal-600 to-blue-700", rotation: "rotate-[-4deg]" },
  { gradient: "from-fuchsia-600 to-indigo-700", rotation: "rotate-[2deg]" },
  { gradient: "from-sky-600 to-purple-700", rotation: "rotate-[-3deg]" },
  { gradient: "from-violet-700 to-rose-600", rotation: "rotate-[5deg]" },
  { gradient: "from-cyan-600 to-emerald-700", rotation: "rotate-[-2deg]" },
  { gradient: "from-pink-600 to-orange-600", rotation: "rotate-[3deg]" },
  { gradient: "from-blue-700 to-teal-600", rotation: "rotate-[-4deg]" },
]

const VALUE_PROPS = [
  { value: "0", label: "Downloads", desc: "Stream directly from your browser. No OBS, no plugins." },
  { value: "1", label: "Link", desc: "Share a single link to invite guests on stage instantly." },
  { value: "3+", label: "Platforms", desc: "Simulcast to YouTube, X, LinkedIn and more at once." },
  { value: "\u221E", label: "Possibilities", desc: "Layouts, overlays, and tools to make your stream yours." },
]

function formatViewers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

export function HomeHero() {
  const { authenticated } = usePrivy()
  const observerRef = useRef<IntersectionObserver | null>(null)
  const liveCountRef = useRef<HTMLSpanElement>(null)

  const streams = useQuery(api.streams.listLiveStreams, {
    category: null,
    searchQuery: "",
  })
  const recentStreams = useQuery(api.streams.listRecentStreams, { limit: 8 })

  const liveCount = streams?.length ?? 0
  const hasStreams = streams !== undefined && streams.length > 0
  const hasRecentStreams = recentStreams !== undefined && recentStreams.length > 0

  useEffect(() => {
    if (liveCountRef.current) {
      liveCountRef.current.textContent =
        streams === undefined
          ? "Loading\u2026"
          : liveCount === 0
            ? "No one live yet"
            : `${liveCount} creator${liveCount === 1 ? "" : "s"} live now`
    }
  }, [streams, liveCount])

  useEffect(() => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const el = entry.target as HTMLElement
              const delay = el.getAttribute("data-animate-delay")
              if (delay) {
                el.style.transitionDelay = `${parseInt(delay) * 100}ms`
              }
              el.classList.add("is-visible")
              observerRef.current?.unobserve(el)
            }
          })
        },
        { threshold: 0.1 },
      )
    }

    // Re-scan: observe any new [data-animate] elements that aren't already visible
    const elements = document.querySelectorAll("[data-animate]:not(.is-visible)")
    elements.forEach((el) => observerRef.current?.observe(el))

    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [streams, recentStreams])

  const primaryCta = authenticated
    ? { label: "Go Live", href: "/studio" }
    : { label: "Start Streaming", href: "/sign-in" }

  return (
    <div className={cn(syne.variable, "min-h-screen bg-[#09090b] text-zinc-100")}>
      <style>{`
        @keyframes drift-1 {
          0%, 100% { transform: translate(0, 0) rotate(2deg); }
          25% { transform: translate(8px, -6px) rotate(3deg); }
          50% { transform: translate(-4px, 8px) rotate(1deg); }
          75% { transform: translate(6px, 4px) rotate(2.5deg); }
        }
        @keyframes drift-2 {
          0%, 100% { transform: translate(0, 0) rotate(-3deg); }
          25% { transform: translate(-6px, 8px) rotate(-2deg); }
          50% { transform: translate(8px, -4px) rotate(-4deg); }
          75% { transform: translate(-4px, -6px) rotate(-2.5deg); }
        }
        @keyframes drift-3 {
          0%, 100% { transform: translate(0, 0) rotate(4deg); }
          25% { transform: translate(6px, 6px) rotate(3deg); }
          50% { transform: translate(-8px, -4px) rotate(5deg); }
          75% { transform: translate(4px, -8px) rotate(3.5deg); }
        }
        @keyframes drift-4 {
          0%, 100% { transform: translate(0, 0) rotate(-2deg); }
          25% { transform: translate(-8px, 4px) rotate(-3deg); }
          50% { transform: translate(6px, -8px) rotate(-1deg); }
          75% { transform: translate(-4px, 6px) rotate(-2.5deg); }
        }
        @keyframes drift-5 {
          0%, 100% { transform: translate(0, 0) rotate(3deg); }
          25% { transform: translate(4px, -8px) rotate(4deg); }
          50% { transform: translate(-6px, 6px) rotate(2deg); }
          75% { transform: translate(8px, -4px) rotate(3.5deg); }
        }
        @keyframes drift-6 {
          0%, 100% { transform: translate(0, 0) rotate(-4deg); }
          25% { transform: translate(-4px, -6px) rotate(-3deg); }
          50% { transform: translate(8px, 4px) rotate(-5deg); }
          75% { transform: translate(-6px, 8px) rotate(-3.5deg); }
        }

        .mosaic-tile-0 { animation: drift-1 18s ease-in-out infinite; }
        .mosaic-tile-1 { animation: drift-2 22s ease-in-out infinite; }
        .mosaic-tile-2 { animation: drift-3 16s ease-in-out infinite; }
        .mosaic-tile-3 { animation: drift-4 20s ease-in-out infinite; }
        .mosaic-tile-4 { animation: drift-5 24s ease-in-out infinite; }
        .mosaic-tile-5 { animation: drift-6 15s ease-in-out infinite; }
        .mosaic-tile-6 { animation: drift-1 21s ease-in-out infinite; }
        .mosaic-tile-7 { animation: drift-2 17s ease-in-out infinite; }
        .mosaic-tile-8 { animation: drift-3 23s ease-in-out infinite; }
        .mosaic-tile-9 { animation: drift-4 19s ease-in-out infinite; }
        .mosaic-tile-10 { animation: drift-5 25s ease-in-out infinite; }
        .mosaic-tile-11 { animation: drift-6 16s ease-in-out infinite; }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .hero-pill { opacity: 0; animation: fadeInUp 0.6s ease forwards 0.05s; }
        .hero-line-1 { opacity: 0; animation: fadeInUp 0.6s ease forwards 0.2s; }
        .hero-line-2 { opacity: 0; animation: fadeInUp 0.6s ease forwards 0.35s; }
        .hero-line-3 { opacity: 0; animation: fadeInUp 0.6s ease forwards 0.5s; }
        .hero-sub { opacity: 0; animation: fadeInUp 0.6s ease forwards 0.7s; }
        .hero-cta { opacity: 0; animation: fadeInUp 0.6s ease forwards 0.85s; }
        .hero-stats { opacity: 0; animation: fadeIn 0.8s ease forwards 1.1s; }

        [data-animate] {
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        [data-animate].is-visible {
          opacity: 1;
          transform: translateY(0);
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .live-pulse { animation: livePulse 2s ease-in-out infinite; }
      `}</style>

      {/* ===== HERO ===== */}
      <section className="relative h-[85vh] min-h-[600px] overflow-hidden bg-[#09090b]">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-4 gap-4 p-6 opacity-[0.37] sm:grid-cols-3 sm:grid-rows-3 sm:gap-4 sm:p-8 lg:grid-cols-4">
          {MOSAIC_TILES.map((tile, i) => (
            <div
              key={i}
              className={cn(
                `mosaic-tile-${i}`,
                "rounded-xl bg-gradient-to-br",
                tile.gradient,
                tile.rotation,
              )}
            />
          ))}
        </div>

        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(9,9,11,0.8) 0%, rgba(9,9,11,0.4) 50%, rgba(9,9,11,0.7) 100%), linear-gradient(to top, rgba(9,9,11,1) 0%, transparent 50%)",
          }}
        />

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="hero-pill mb-8 inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/80 px-4 py-2 backdrop-blur-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500 live-pulse" />
            <span ref={liveCountRef} className="text-sm text-zinc-300">Loading&hellip;</span>
          </div>

          <h1 className={cn(syne.className, "mb-6")}>
            <span className="hero-line-1 block text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl">
              Your Stage.
            </span>
            <span className="hero-line-2 block text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl">
              Your Audience.
            </span>
            <span className="hero-line-3 block bg-gradient-to-r from-[oklch(0.645_0.246_16.439)] to-orange-400 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-6xl lg:text-7xl">
              Your Rules.
            </span>
          </h1>

          <p className="hero-sub mx-auto max-w-xl text-lg text-zinc-400 sm:text-xl">
            The browser-based streaming platform built for creators who want control.
          </p>

          <div className="hero-cta mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href={primaryCta.href}
              className="inline-flex h-12 items-center rounded-lg bg-[oklch(0.645_0.246_16.439)] px-8 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[oklch(0.7_0.22_16)]"
            >
              {primaryCta.label}
            </Link>
            <Link
              href="/browse"
              className="inline-flex h-12 items-center rounded-lg border border-zinc-700 px-8 text-sm font-semibold text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
            >
              Browse Streams
            </Link>
          </div>

          <div className="hero-stats absolute bottom-12 left-0 right-0 flex items-center justify-center gap-2 text-sm">
            <span className="font-medium text-zinc-300">2.4K Creators</span>
            <span className="text-zinc-500">&middot;</span>
            <span className="font-medium text-zinc-300">156K Hours Streamed</span>
            <span className="text-zinc-500">&middot;</span>
            <span className="font-medium text-zinc-300">89 Countries</span>
          </div>
        </div>
      </section>

      {/* ===== VALUE PROPS ===== */}
      <section className="border-y border-zinc-800/50 bg-zinc-950 py-16">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {VALUE_PROPS.map((prop, i) => (
              <div
                key={prop.label}
                data-animate=""
                data-animate-delay={i.toString()}
                className="rounded-xl border border-zinc-800 border-t-2 border-t-[oklch(0.645_0.246_16.439)] bg-zinc-900 p-6"
              >
                <div className={cn(syne.className, "text-4xl font-black text-zinc-100")}>{prop.value}</div>
                <div className="mt-1 text-sm font-medium uppercase tracking-wider text-zinc-400">{prop.label}</div>
                <p className="mt-2 text-sm text-zinc-500">{prop.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== DISCOVERY ===== */}
      <section id="discover" className="scroll-mt-16 py-20">
        <div className="mx-auto max-w-7xl px-6">
          {streams === undefined || (!hasStreams && recentStreams === undefined) ? (
            /* Loading — wait for both queries before rendering */
            <div>
              <div className="mb-10 flex items-center gap-3">
                <div className="h-3 w-3 animate-pulse rounded-full bg-zinc-700" />
                <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-800" />
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                    <div className="aspect-video animate-pulse bg-zinc-800" />
                    <div className="p-4 pt-5">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
                      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : hasStreams ? (
            /* Live streams grid */
            <div>
              <div className="mb-10 flex items-center gap-3" data-animate="">
                <span className="inline-block h-3 w-3 rounded-full bg-red-500 live-pulse" />
                <h2 className={cn(syne.className, "text-3xl font-bold sm:text-4xl")}>Live Right Now</h2>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {streams.map(({ stream, creator }, i) => {
                  const thumbnailUrl = stream.playbackUrl ? getThumbnailUrl(stream.playbackUrl) : null
                  const username = creator?.username ?? ""
                  const avatarSrc = creator?.avatarUrl ?? null
                  const initial = (username[0] ?? "?").toUpperCase()

                  return (
                    <Link
                      key={stream._id}
                      href={username ? `/${username}` : "#"}
                      data-animate=""
                      data-animate-delay={i.toString()}
                      className="group relative cursor-pointer overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-transform duration-200 hover:scale-[1.02]"
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-zinc-800">
                        {thumbnailUrl ? (
                          <img src={thumbnailUrl} alt={stream.title} className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <span className="text-xs text-zinc-600">No preview</span>
                          </div>
                        )}
                        <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-white live-pulse" />
                          LIVE
                        </div>
                        <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200 backdrop-blur-sm">
                          {stream.category}
                        </div>
                        {/* Creator avatar chip */}
                        <div className="absolute bottom-[-12px] left-3 flex h-8 w-8 items-center justify-center rounded-full bg-[oklch(0.645_0.246_16.439)] text-xs font-bold text-white ring-2 ring-zinc-900">
                          {avatarSrc ? (
                            <img src={avatarSrc} alt={username} className="size-full rounded-full object-cover" />
                          ) : (
                            initial
                          )}
                        </div>
                      </div>

                      {/* Info area */}
                      <div className="p-4 pt-5">
                        <h3 className={cn(syne.className, "truncate text-sm font-semibold text-zinc-100")}>
                          {stream.title}
                        </h3>
                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                          <span>{username ? `@${username}` : "Unknown"}</span>
                          <span>&middot;</span>
                          <span>{formatViewers(stream.viewerCount)} viewers</span>
                        </div>
                      </div>

                      {/* Hover bottom bar */}
                      <div className="absolute bottom-0 left-0 right-0 h-[2px] origin-left scale-x-0 bg-[oklch(0.645_0.246_16.439)] transition-transform duration-300 group-hover:scale-x-100" />
                    </Link>
                  )
                })}
              </div>
            </div>
          ) : (
            /* No live streams fallback */
            <div>
              {/* Recent streams */}
              {hasRecentStreams && (
                <div data-animate="">
                  <div className="mb-10 flex items-center gap-3">
                    <h2 className={cn(syne.className, "text-3xl font-bold sm:text-4xl")}>Recent Streams</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {recentStreams.map(({ stream, creator }, i) => {
                      const thumbnailUrl = stream.playbackUrl ? getThumbnailUrl(stream.playbackUrl) : null
                      const username = creator?.username ?? ""
                      const avatarSrc = creator?.avatarUrl ?? null
                      const initial = (username[0] ?? "?").toUpperCase()

                      return (
                        <Link
                          key={stream._id}
                          href={username ? `/${username}` : "#"}
                          data-animate=""
                          data-animate-delay={i.toString()}
                          className="group relative cursor-pointer overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-transform duration-200 hover:scale-[1.02]"
                        >
                          <div className="relative aspect-video bg-zinc-800">
                            {thumbnailUrl ? (
                              <img src={thumbnailUrl} alt={stream.title} className="size-full object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center">
                                <span className="text-xs text-zinc-600">No preview</span>
                              </div>
                            )}
                            <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200 backdrop-blur-sm">
                              {stream.category}
                            </div>
                            <div className="absolute bottom-[-12px] left-3 flex h-8 w-8 items-center justify-center rounded-full bg-[oklch(0.645_0.246_16.439)] text-xs font-bold text-white ring-2 ring-zinc-900">
                              {avatarSrc ? (
                                <img src={avatarSrc} alt={username} className="size-full rounded-full object-cover" />
                              ) : (
                                initial
                              )}
                            </div>
                          </div>
                          <div className="p-4 pt-5">
                            <h3 className={cn(syne.className, "truncate text-sm font-semibold text-zinc-100")}>
                              {stream.title}
                            </h3>
                            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                              <span>{username ? `@${username}` : "Unknown"}</span>
                              <span>&middot;</span>
                              <span>{formatViewers(stream.peakViewerCount)} peak viewers</span>
                            </div>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 h-[2px] origin-left scale-x-0 bg-[oklch(0.645_0.246_16.439)] transition-transform duration-300 group-hover:scale-x-100" />
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Go Live CTA */}
              <div className={cn(hasRecentStreams && "mt-20 border-t border-zinc-800/50 pt-16")} data-animate="">
                <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                  {/* Background accent — subtle mosaic echo */}
                  <div className="absolute inset-0 opacity-[0.08]">
                    <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-[oklch(0.645_0.246_16.439)]" />
                    <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-orange-500" />
                  </div>

                  <div className="relative flex flex-col items-center px-8 py-16 text-center sm:py-20">
                    <p className="text-sm font-medium uppercase tracking-widest text-[oklch(0.645_0.246_16.439)]">
                      Your audience is waiting
                    </p>
                    <h2 className={cn(syne.className, "mt-4 text-4xl font-black tracking-tight sm:text-5xl")}>
                      Go Live Now
                    </h2>
                    <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-zinc-400">
                      Open your browser and start streaming in seconds.
                      Invite guests, pick a layout, and reach every platform.
                    </p>
                    <Link
                      href={authenticated ? "/studio" : "/sign-in"}
                      className="mt-8 inline-flex h-12 items-center rounded-lg bg-[oklch(0.645_0.246_16.439)] px-10 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[oklch(0.7_0.22_16)]"
                    >
                      {authenticated ? "Open Studio" : "Get Started"}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-zinc-800/50 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-6 md:flex-row md:justify-between">
          <div className={cn(syne.className, "text-xl font-bold text-zinc-400")}>Switched</div>
          <nav className="flex items-center gap-4 text-sm text-zinc-500" aria-label="Footer navigation">
            {["About", "Creators", "Blog", "Careers"].map((item) => (
              <Link key={item} href="#" className="transition-colors duration-200 hover:text-zinc-300">
                {item}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col items-center gap-2 md:items-end">
            <div className="flex items-center gap-4 text-sm text-zinc-500">
              {["Twitter", "Discord", "YouTube"].map((item) => (
                <Link
                  key={item}
                  href="#"
                  className="transition-colors duration-200 hover:text-zinc-300"
                  aria-label={`Switched on ${item}`}
                >
                  {item}
                </Link>
              ))}
            </div>
            <span className="text-xs text-zinc-600">&copy; 2026 Switched</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
