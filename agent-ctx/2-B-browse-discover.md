# Task 2-B — Agent browse-discover

Task: Phase 2 of SpotiBot — implement a Spotify-style Browse/Discover view (genre tiles + mood filters) backed by an owner-scoped `/api/browse` endpoint.

## Files owned & created
- `src/app/api/browse/route.ts` — GET aggregated + filtered browse data.
- `src/components/music/browse-view.tsx` — Browse view (genre grid + mood chips + filtered track list).

## API (`src/app/api/browse/route.ts`)
- `GET /api/browse` — auth required (401 if not signed in); all queries scoped by `ownerId = getCurrentUserId()`.
- Reads `genre` and `mood` query params via `new URL(req.url).searchParams`.
- Validates both against the canonical `GENRES`/`MOODS` lists (from `@/lib/types`); unknown values → 400.
- Three response shapes:
  1. No params → `{ genres: [{ genre, count, songs: Song[] }, ...] }`. Top 4 songs per genre (newest first); only genres with ≥1 song are returned. Implemented as `Promise.all` over `GENRES` running `db.song.count` + `db.song.findMany({ take: 4 })` per genre in parallel — at most 10 small queries, no N+1.
  2. `?genre=Pop` → `{ songs: Song[] }` (up to 100, newest first).
  3. `?genre=Pop&mood=Happy` → `{ songs: Song[] }` filtered by both.
- Uses `db` from `@/lib/db` and `toPublicSong` from `@/lib/song-mapper` (same as every other API route).
- 500 path: catches all errors, logs server-side, returns generic `{ error: "Failed to load browse data." }` — no stack leakage, mirroring the `songs`/`playlists` routes.

## UI (`src/components/music/browse-view.tsx`)
- `'use client'` component, dark theme, no indigo/blue.
- **Genre grid**: all 10 GENRES as colorful gradient tiles in a responsive grid (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`), each `aspect-[16/10]`. Gradient is deterministic per genre name via a `hueFromString` hash → `linear-gradient(135deg, hsl(h 65% 42%), hsl((h+40) 75% 32%))` (same hashing scheme as `cover-image.tsx` for consistency). Each tile shows the genre name + track count (from the aggregate fetch). Clicking a tile toggles the filter on/off.
- **Mood chips**: "All" + 8 MOODS in a `flex-wrap` row. Active chip uses fuchsia accent (`border-fuchsia-400 bg-fuchsia-500/20`); inactive uses `white/[0.04]` muted surface.
- **Track list**: reuses the existing `<TrackList/>` from `./track-list`, passing through `onToggleLike`, `onDelete`, `playlists`, `onAddToPlaylist`, `onCreatePlaylist`.
- State: `selectedGenre`, `selectedMood`, `songs`, `loading`, plus `genres` (cached aggregate buckets) and `error`.
- **Single-effect data flow** (one `useEffect` keyed on `[selectedGenre, selectedMood, genres]`):
  - On mount (no genre, no cached genres): fetches `GET /api/browse` → caches buckets + seeds `songs` with the flattened previews (top 4 per genre).
  - When a genre is selected: fetches `GET /api/browse?genre=X[&mood=Y]` and shows the full result set.
  - When a mood chip is clicked with no genre: client-filters the cached previews by mood (no network round-trip). With a genre: refetches with the mood param.
  - `cancelled` flag in the cleanup prevents stale writes after rapid filter changes.
- UX details: Reset-filters button appears when any filter is active; empty state (Sparkles icon + hint) when no tracks match; error state (rose-tinted alert) when a fetch fails; dynamic section heading ("Featured" → "Pop" → "Pop · Happy").
- Accessibility: every tile/chip is a real `<button>` with `aria-pressed` + descriptive `aria-label`; sections have `aria-label`; focus-visible rings on all interactive elements.
- Sticky footer / layout is left to the parent — this component is a self-contained `<div className="space-y-8 pb-6">` block.

## Verification
- `bun run lint` → EXIT 0 (no errors, no warnings) for both new files.
- Dev log clean (no compile errors after the new files were created).
- Component is not wired into `page.tsx` (per spec — I only own the two files; integration is the orchestrator's job).

## Notes for the orchestrator
- To mount this view, render `<BrowseView ... />` somewhere in `page.tsx` and pass through the same `onToggleLike`/`onDelete`/`playlists`/`onAddToPlaylist`/`onCreatePlaylist` handlers already used by the existing `<TrackList/>` instances. A new `SidebarView` value (e.g. `"browse"`) and sidebar nav entry is the natural integration point.
- The aggregated `/api/browse` response is small (≤ 10 genres × 4 songs = ≤ 40 song objects, no audio bytes), so it's safe to fetch on every Browse view mount with `cache: "no-store"`.
