# Task 4-B — Agent analytics

Task: Phase 4 of SpotiBot — build a creator analytics dashboard backed by an owner-scoped `/api/stats` endpoint.

## Files owned & created
- `src/app/api/stats/route.ts` — `GET /api/stats` aggregated stats for the current user.
- `src/components/music/analytics-view.tsx` — the analytics dashboard component (self-contained, fetches its own data).

## API (`src/app/api/stats/route.ts`)
- `GET /api/stats` — auth required (401 if not signed in); every query scoped by `ownerId = getCurrentUserId()`, mirroring the rest of the API surface.
- `force-dynamic` (stats change on every play / generation, so caching the GET would surface stale data).
- Two parallel Prisma queries fetch only the columns we need:
  - `db.song.findMany({ where: { ownerId }, select: { id, title, genre, mood, liked, createdAt } })`.
  - `db.listeningHistory.findMany({ where: { song: { ownerId } }, select: { songId, playedAt } })`.
  - `ListeningHistory` cascades on song delete, so every history row belongs to a still-existing song — no orphans to worry about.
- All aggregation done in JS to keep SQLite load light and avoid N+1 / window-function workarounds.
- Returned `StatsResponse` shape (exported as a TypeScript interface so the client stays in lock-step):
  ```ts
  interface StatsResponse {
    totalTracks: number;
    totalLikes: number;
    totalPlays: number;
    tracksByGenre: { genre: string; count: number }[];
    tracksByMood:  { mood: string;  count: number }[];
    recentPlays: number; // plays where playedAt > now - 7d
    mostPlayedTrack: { id: string; title: string; plays: number } | null;
    generationThisMonth: number; // songs with createdAt in current calendar month
  }
  ```
- `tracksByGenre` / `tracksByMood` sorted by count desc then name asc (stable, deterministic).
- `mostPlayedTrack` aggregates plays per `songId` in a single pass; ties resolve to the first-encountered song; the song id is then joined back to the songs list for the title (defensive guard even though cascade-delete guarantees the row exists).
- `generationThisMonth` uses the first instant of the current calendar month in local time: `new Date(now.getFullYear(), now.getMonth(), 1)`.
- 500 path: catches all errors, logs server-side via `console.error("stats: failed to aggregate", err)`, returns generic `{ error: "Failed to load analytics." }` — no stack leakage, mirroring the `songs` / `browse` / `playlists` routes.

## UI (`src/components/music/analytics-view.tsx`)
- `'use client'` component, dark theme, glassmorphism cards (uses the existing `.glass-card` utility class from `globals.css`), fuchsia/violet/rose/emerald accents — no indigo/blue.
- **Props: none** — self-contained; fetches `/api/stats` on mount with a cancellation guard to prevent stale writes.
- **Layout**:
  1. **Stat cards row** — responsive grid (`grid-cols-2 sm:grid-cols-4`) with 4 cards: Total Tracks, Total Likes, Total Plays, Recent Plays (7d). Each card has an accent-colored icon chip + large number + optional sublabel.
  2. **Highlights row** — `lg:grid-cols-3`:
     - **Most Played Track** card (col-span-2 on lg) — uses the shared `<CoverImage/>` to render the AI cover at `/api/cover/{id}` (falls back to deterministic gradient on missing cover), with the track title and play count beside it. Empty state when `mostPlayedTrack === null`.
     - **This Month's Generations** card — big gradient-text number + "tracks created in {current month name}" caption.
  3. **Breakdown row** — `lg:grid-cols-2`: Genre breakdown card + Mood breakdown card, both rendering a CSS-only horizontal bar chart:
     - Each row: label + count + a 2px-tall gradient bar whose width is `(count / maxCount) * 100%` (clamped to ≥4% so a single-track genre still shows a visible sliver).
     - Bar gradient is deterministic per genre/mood name via a `hueFromString` hash (same scheme as `cover-image.tsx` and `browse-view.tsx`).
     - Long lists scroll within `max-h-96 overflow-y-auto` with the project's custom fuchsia scrollbar.
     - Empty state per card (Music2 icon + hint).
- **Loading skeletons**: a dedicated `<AnalyticsSkeleton/>` renders during the fetch — pulsing blocks matching the layout of stat cards, highlights row, and breakdown row. Wrapping `div` carries `aria-busy="true"` + `aria-live="polite"` + an `sr-only` "Loading analytics…" message.
- **Error state**: rose-tinted alert (AlertCircle icon + error message) replaces the dashboard if the fetch fails.
- **Animations**: subtle Framer Motion staggered entry (container + item variants) — items fade-up with `staggerChildren: 0.06`. The bar widths also transition on mount via `transition-[width] duration-500 ease-out` for a smooth grow effect.
- **Accessibility**:
  - Each section wrapped in `<section aria-label="…">`.
  - All headings are real `<h1>`/`<h2>`.
  - The pulsing skeleton is `aria-busy` + has a screen-reader-only status message.
  - The error block carries `role="alert"`.
  - All decorative icons are `aria-hidden`.
- **TypeScript strict, no `any`**: the `StatsResponse` type is mirrored locally (not imported from the server route, which is server-only) — same convention as `browse-view.tsx` and `feed-view.tsx`. `AccentName` is a literal union type for the stat-card accent lookup.

## Verification
- `cd /home/z/my-project && bun run lint` → EXIT 0, no errors, no warnings across the whole project.
- `npx tsc --noEmit` → 0 errors in my two files. (Pre-existing TS errors in other agents' files — `examples/websocket`, `skills/image-edit`, `src/app/api/generate`, `src/app/api/notifications`, `src/app/layout.tsx`, `src/components/music/song-card`, `src/components/music/song-detail`, `src/components/music/top-bar` — were NOT touched and are out of my ownership. The dev.log compile errors are also from other agents' files — the `ThemeToggle` named-vs-default export mismatch between Agent 2-C and the orchestrator's integration in `top-bar.tsx`.)
- Dev log shows no compile errors related to `stats` or `analytics-view`.

## Notes for the orchestrator
- To mount the dashboard: render `<AnalyticsView />` somewhere in `page.tsx` (e.g. behind a new `SidebarView` value like `"analytics"` or `"stats"`). The component is fully self-contained — no props, no parent state, fetches its own data.
- The `/api/stats` payload is small (no audio/cover bytes; just counts + one title + one id), so `cache: "no-store"` on every mount is fine.
- The `mostPlayedTrack` cover is loaded via `/api/cover/{id}` which is owner-scoped — a non-owner can't load another user's cover, so the dashboard remains private.
- Optional future extension (out of scope here): if `mostPlayedTrack` should show its `audioUrl` / `liked` state, extend the server payload. The current shape matches the spec exactly (`{ id, title, plays }`).
