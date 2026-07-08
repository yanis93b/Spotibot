"use client";

/**
 * AnalyticsView — Creator Analytics dashboard.
 *
 * Self-contained: fetches `GET /api/stats` on mount, renders a dark-theme
 * glassmorphism dashboard with:
 *   1. Stat cards row — Total Tracks · Total Likes · Total Plays · Recent
 *      Plays (7d).
 *   2. Genre breakdown — horizontal CSS-only bar chart (track count per
 *      genre).
 *   3. Mood breakdown — same shape, per mood.
 *   4. Most played track — card with cover + title + play count.
 *   5. This month's generations — big number card.
 *
 * Props: none. The component owns its own fetch + state.
 *
 * Styling follows the rest of the music UI: fuchsia/violet/rose accents on
 * the dark `music-bg` backdrop, `.glass-card` surfaces, custom scrollbar.
 * No indigo/blue. Loading skeletons during the fetch; error alert on
 * failure; empty states per section.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  Disc3,
  Heart,
  Play,
  Sparkles,
  Trophy,
  Music2,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CoverImage } from "./cover-image";

// ── Local copy of the server response shape ──────────────────────────────
// Mirrors `StatsResponse` in `src/app/api/stats/route.ts`. Duplicated so
// the client bundle doesn't import the (server-only) route file — same
// convention as `browse-view.tsx` and `feed-view.tsx`.
interface StatsResponse {
  totalTracks: number;
  totalLikes: number;
  totalPlays: number;
  tracksByGenre: { genre: string; count: number }[];
  tracksByMood: { mood: string; count: number }[];
  recentPlays: number;
  mostPlayedTrack: { id: string; title: string; plays: number } | null;
  generationThisMonth: number;
}

/** Deterministic hue (0–360) from a string — same scheme as cover-image. */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Current month name for the "This Month's Generations" caption. */
function currentMonthName(now: Date = new Date()): string {
  return now.toLocaleString(undefined, { month: "long" });
}

/** Container variant for staggered Framer Motion entry. */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

export function AnalyticsView() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch on mount with cancellation guard ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StatsResponse;
        if (cancelled) return;
        setStats(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stats.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 pb-6">
      {/* ── Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Trophy className="size-5 text-fuchsia-400" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Creator Analytics
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Track your library&apos;s performance at a glance — plays, likes, and
          what you&apos;ve been creating lately.
        </p>
      </header>

      {/* ── Error state (whole dashboard) */}
      {error ? (
        <div
          role="alert"
          className="glass-card flex items-center gap-3 p-6 text-sm text-rose-300"
        >
          <AlertCircle className="size-5 shrink-0" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium">Couldn&apos;t load your analytics.</p>
            <p className="text-rose-300/70">{error}</p>
          </div>
        </div>
      ) : loading ? (
        <AnalyticsSkeleton />
      ) : stats ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* ── Stat cards row */}
          <section
            aria-label="Top-level stats"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
          >
            <StatCard
              label="Total Tracks"
              value={stats.totalTracks}
              icon={<Disc3 className="size-4" aria-hidden />}
              accent="fuchsia"
            />
            <StatCard
              label="Total Likes"
              value={stats.totalLikes}
              icon={<Heart className="size-4" aria-hidden />}
              accent="rose"
            />
            <StatCard
              label="Total Plays"
              value={stats.totalPlays}
              icon={<Play className="size-4" aria-hidden />}
              accent="violet"
            />
            <StatCard
              label="Recent Plays"
              sublabel="Last 7 days"
              value={stats.recentPlays}
              icon={<Activity className="size-4" aria-hidden />}
              accent="emerald"
            />
          </section>

          {/* ── Most played + This month's generations */}
          <section
            aria-label="Highlights"
            className="grid grid-cols-1 gap-4 lg:grid-cols-3"
          >
            {/* Most played — spans 2 cols on lg */}
            <motion.div
              variants={itemVariants}
              className="glass-card flex flex-col gap-3 p-5 lg:col-span-2"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Most Played Track
                </h2>
                <Trophy className="size-4 text-fuchsia-400" aria-hidden />
              </div>
              {stats.mostPlayedTrack ? (
                <div className="flex items-center gap-4">
                  <CoverImage
                    id={stats.mostPlayedTrack.id}
                    // The stats payload only carries id + title; load the
                    // cover from /api/cover/{id}. CoverImage falls back to
                    // a deterministic gradient on 404 / missing cover.
                    src={`/api/cover/${stats.mostPlayedTrack.id}`}
                    alt={`Cover art for ${stats.mostPlayedTrack.title}`}
                    size={72}
                    rounded="rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-foreground">
                      {stats.mostPlayedTrack.title}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <span className="font-medium text-fuchsia-300">
                        {stats.mostPlayedTrack.plays}
                      </span>{" "}
                      {stats.mostPlayedTrack.plays === 1 ? "play" : "plays"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <Play className="size-6 text-fuchsia-300/60" aria-hidden />
                  <p className="text-sm text-muted-foreground">
                    No plays recorded yet.
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Play one of your tracks to see it here.
                  </p>
                </div>
              )}
            </motion.div>

            {/* This month's generations */}
            <motion.div
              variants={itemVariants}
              className="glass-card flex flex-col justify-between gap-3 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  This Month
                </h2>
                <CalendarDays className="size-4 text-fuchsia-400" aria-hidden />
              </div>
              <div className="space-y-1">
                <p className="bg-gradient-to-r from-fuchsia-300 via-violet-300 to-rose-300 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent">
                  {stats.generationThisMonth}
                </p>
                <p className="text-sm text-muted-foreground">
                  {stats.generationThisMonth === 1
                    ? `track created in ${currentMonthName()}`
                    : `tracks created in ${currentMonthName()}`}
                </p>
              </div>
            </motion.div>
          </section>

          {/* ── Genre + Mood breakdown */}
          <section
            aria-label="Breakdowns"
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <BreakdownCard
              title="Tracks by Genre"
              icon={<Disc3 className="size-4" aria-hidden />}
              items={stats.tracksByGenre.map((g) => ({
                key: g.genre,
                label: g.genre,
                count: g.count,
              }))}
              emptyHint="Generate tracks to see genre breakdown."
            />
            <BreakdownCard
              title="Tracks by Mood"
              icon={<Sparkles className="size-4" aria-hidden />}
              items={stats.tracksByMood.map((m) => ({
                key: m.mood,
                label: m.mood,
                count: m.count,
              }))}
              emptyHint="Generate tracks to see mood breakdown."
            />
          </section>
        </motion.div>
      ) : null}
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────
type AccentName = "fuchsia" | "rose" | "violet" | "emerald";

const ACCENT_CLASSES: Record<AccentName, { icon: string; ring: string }> = {
  fuchsia: {
    icon: "text-fuchsia-300 bg-fuchsia-500/15",
    ring: "ring-fuchsia-500/20",
  },
  rose: {
    icon: "text-rose-300 bg-rose-500/15",
    ring: "ring-rose-500/20",
  },
  violet: {
    icon: "text-violet-300 bg-violet-500/15",
    ring: "ring-violet-500/20",
  },
  emerald: {
    icon: "text-emerald-300 bg-emerald-500/15",
    ring: "ring-emerald-500/20",
  },
};

function StatCard({
  label,
  sublabel,
  value,
  icon,
  accent,
}: {
  label: string;
  sublabel?: string;
  value: number;
  icon: React.ReactNode;
  accent: AccentName;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        "glass-card relative overflow-hidden p-4 ring-1 ring-inset sm:p-5",
        a.ring,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "grid size-7 place-items-center rounded-full",
            a.icon,
          )}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {value}
      </p>
      {sublabel ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>
      ) : null}
    </motion.div>
  );
}

// ── Breakdown card (genre / mood) ────────────────────────────────────────
interface BreakdownItem {
  key: string;
  label: string;
  count: number;
}

function BreakdownCard({
  title,
  icon,
  items,
  emptyHint,
}: {
  title: string;
  icon: React.ReactNode;
  items: BreakdownItem[];
  emptyHint: string;
}) {
  const max = items.reduce((m, i) => (i.count > m ? i.count : m), 0);

  return (
    <motion.div variants={itemVariants} className="glass-card flex flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <span className="grid size-7 place-items-center rounded-full bg-white/[0.05] text-fuchsia-300">
          {icon}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <Music2 className="size-6 text-fuchsia-300/60" aria-hidden />
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        </div>
      ) : (
        <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {items.map((item) => {
            const pct = max > 0 ? Math.max(4, (item.count / max) * 100) : 0;
            const hue = hueFromString(item.key);
            const hue2 = (hue + 40) % 360;
            return (
              <li key={item.key} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-foreground">
                    {item.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {item.count}
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-white/[0.05]"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, hsl(${hue} 75% 55%), hsl(${hue2} 70% 50%))`,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────
function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-3 w-20 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="size-7 animate-pulse rounded-full bg-white/[0.06]" />
            </div>
            <div className="mt-3 h-8 w-16 animate-pulse rounded-md bg-white/[0.06]" />
            <div className="mt-2 h-3 w-10 animate-pulse rounded-full bg-white/[0.04]" />
          </div>
        ))}
      </div>

      {/* Highlights row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass-card p-5 lg:col-span-2">
          <div className="h-3 w-32 animate-pulse rounded-full bg-white/[0.06]" />
          <div className="mt-4 flex items-center gap-4">
            <div className="size-[72px] animate-pulse rounded-lg bg-white/[0.06]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded-md bg-white/[0.06]" />
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-white/[0.04]" />
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.06]" />
          <div className="mt-4 h-12 w-20 animate-pulse rounded-md bg-white/[0.06]" />
          <div className="mt-2 h-3 w-28 animate-pulse rounded-full bg-white/[0.04]" />
        </div>
      </div>

      {/* Breakdown row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="glass-card p-5">
            <div className="mb-4 h-3 w-32 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="space-y-1">
                  <div className="flex justify-between">
                    <div className="h-3 w-16 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="h-3 w-6 animate-pulse rounded-full bg-white/[0.04]" />
                  </div>
                  <div className="h-2 w-full animate-pulse rounded-full bg-white/[0.05]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}

export default AnalyticsView;
