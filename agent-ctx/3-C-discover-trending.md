# Task 3-C — Agent discover-trending

Task: Phase 3 of SpotiBot — create a public **Discover feed** + **Trending**
carousel: a no-auth-required feed of all public tracks across all users, plus
trending (most liked this week).

## Files owned & created

- `prisma/schema-discover.md` — documents the new `isPublic Boolean @default(false)` field on `Song` (+ suggested `@@index([isPublic, createdAt])`). Does NOT modify `prisma/schema.prisma` — orchestrator merges + runs `bun run db:push`.
- `src/app/api/discover/route.ts` — PUBLIC `GET /api/discover?page=1&limit=20` paginated feed.
- `src/app/api/trending/route.ts` — PUBLIC `GET /api/trending?limit=20` (most-liked public tracks from the last 7 days).
- `src/components/music/discover-view.tsx` — Discover page (Trending carousel + infinite-scroll grid).

## API contract

### `GET /api/discover` (PUBLIC — no auth)
- Query: `page` (default 1, min 1), `limit` (default 20, min 1, max 100).
- Validates pagination inputs → 400 on invalid `page`/`limit`.
- Prisma query: `where: { isPublic: true }, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit`, run in parallel with `db.song.count({ where: { isPublic: true } })` for the total.
- Response (200): `{ songs: Song[], total: number, page: number, limit: number }`.
- 500 catches all errors, logs server-side, returns generic `{ error: "Failed to load discover feed." }` (no stack leak).
- Uses `toPublicSong` — `ownerId` is NOT in the public `Song` interface, so no user information is exposed by the response. (`liked` reflects the owner's like state; in the discover view the like button is intentionally not shown, so the value is harmless. See `schema-discover.md` privacy notes.)
- `export const dynamic = "force-dynamic"` — the feed changes whenever any user publishes/unpublishes a track.

### `GET /api/trending` (PUBLIC — no auth)
- Query: `limit` (default 20, min 1, max 100).
- Approximation of "trending" (no Likes table yet): `where: { isPublic: true, liked: true, createdAt: { gt: now - 7 days } }, orderBy: { createdAt: "desc" }, take: limit`.
- Cutoff: `new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)`.
- Response (200): `{ songs: Song[] }` (no ownerId).
- Same error-handling + `force-dynamic` conventions as discover.

## UI (`src/components/music/discover-view.tsx`)

`'use client'`. Dark theme. Accent palette is fuchsia/rose (no indigo/blue). Props: `{ onPlay: (song: Song) => void }`.

### Layout
1. **Header** — Compass icon + "Discover" title + tagline.
2. **Trending section** — fetches `/api/trending?limit=20` once on mount.
   - Horizontal scroller (`overflow-x-auto`, `snap-x snap-mandatory`) of `TrendingCard`s (fixed `w-[260px]`, snap-start).
   - Each card: square `CoverImage` (reuses the shared component — AI PNG or deterministic gradient fallback, 3-bar equalizer overlay when playing) + title (truncate) + `genre · mood`. Hover overlay with fuchsia Play/Pause button.
   - Prev/next arrow buttons (ChevronLeft/Right) appear on sm+ — enabled/disabled state tracks `scrollLeft`/`scrollWidth` via an `onScroll` handler (rAF-free, only `setState` of two booleans). Buttons hidden on touch (mobile users swipe).
   - Skeleton row (6 placeholder cards) while loading; orange Flame empty state when no trending tracks; rose ErrorBanner on failure.
3. **Discover feed section** — infinite-scroll grid.
   - Grid: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5`, gap-4.
   - `DiscoverCard`: same shape as TrendingCard but fluid width — cover, title, genre·mood, hover Play button. Card itself is a `role="button"` with `tabIndex=0` + Enter/Space keydown handler. The inner Play button calls `e.stopPropagation()` then `onPlay(song)` — so clicking the play button doesn't double-fire.
   - Player state: each card subscribes to `usePlayerStore` for `current` + `isPlaying` to show the equalizer overlay + toggle the play/pause icon + highlight the currently-playing card with a fuchsia ring.
   - `onPlay(song)` is the parent's responsibility — the parent wires it to `usePlayerStore.getState().playSong(song)` (which already toggles play/pause when called on the current track).

### Infinite scroll
- State: `songs: Song[]`, `page: number` (starts at 1), `total: number`, `loading` (page 1), `loadingMore` (page N>1), `error`.
- Two effects:
  1. Mount effect: fetches `/api/discover?page=1&limit=20`, sets `songs` + `total`, flips `loading` off.
  2. `[page]` effect: when `page > 1`, fetches that page, **appends** to `songs` with a `Set`-based de-dup (in case the underlying order shifted between fetches).
- `IntersectionObserver` on a sentinel `<div ref={sentinelRef}>` at the bottom of the grid. Options: `{ rootMargin: "0px 0px 600px 0px", threshold: 0 }` — starts loading 600px before the sentinel is visible. Callback guards against duplicate fetches: `if (loading || loadingMore || !hasMore) return;` then `loadMore()` (which `setPage(p => p+1)`).
- Observer is re-created whenever `[loadMore, loading, loadingMore, hasMore]` change so the guard reads the latest values.
- `typeof IntersectionObserver === "undefined"` guard for SSR safety.
- Bottom status row: shows `Loader2` spinner + "Loading more…" when fetching, "You've reached the end of the feed." when `!hasMore && songs.length > 0`, or a rose-colored error message if a page-N fetch failed (without clobbering the already-loaded grid).

### Empty / error / loading states
- Page-1 loading: 10-card `FeedSkeleton` (matches the grid layout).
- Page-1 error: rose `ErrorBanner` (replaces the grid).
- Page-1 empty: fuchsia `EmptyFeed` with a "Be the first — share a track" hint.
- Trending loading: 6-card `TrendingSkeleton` (horizontal).
- Trending empty: orange `EmptyTrending` ("No trending tracks yet this week").
- Trending error: same `ErrorBanner`.

## TypeScript strictness
- No `any` anywhere. All API responses are typed via local interfaces (`DiscoverPage`, `TrendingResponse`) that mirror the server-side `DiscoverResponse`/`TrendingResponse` shapes.
- All `useEffect` cleanups use a `cancelled` flag to prevent stale writes after rapid filter/scroll changes.
- All event handlers properly typed (`React.MouseEvent`, `React.KeyboardEvent`).

## Lint
`cd /home/z/my-project && bun run lint` → CLEAN for my files (0 errors, 0 warnings in `discover/route.ts`, `trending/route.ts`, `discover-view.tsx`, `schema-discover.md`).

The remaining 3 lint problems reported by `eslint .` are in files I do NOT own:
- `src/app/api/feed/route.ts:150` — unused eslint-disable directive (another agent's file).
- `src/components/music/share-dialog.tsx:98,115` — `react-hooks/set-state-in-effect` (another agent's file).

I did not touch either file.

## TypeScript (informational)
`npx tsc --noEmit` reports 3 errors in my API routes:
```
src/app/api/discover/route.ts(82,18): error TS2353: 'isPublic' does not exist in type 'SongWhereInput'.
src/app/api/discover/route.ts(87,32): error TS2353: 'isPublic' does not exist in type 'SongWhereInput'.
src/app/api/trending/route.ts(72,9):  error TS2353: 'isPublic' does not exist in type 'SongWhereInput'.
```
These are EXPECTED — the routes are written against the future schema where `Song` has the `isPublic` column (documented in `prisma/schema-discover.md`). The Prisma Client doesn't know about `isPublic` until the orchestrator merges the schema addendum and runs `bun run db:push`. This is the same pattern Task 2-A used for `ListeningHistory` (see worklog). ESLint doesn't deep-type-check Prisma client field access, so `bun run lint` passes.

## Orchestrator follow-ups (documented in schema-discover.md)
1. Merge `isPublic Boolean @default(false)` + `@@index([isPublic, createdAt])` into `prisma/schema.prisma` `Song` model, then `bun run db:push`.
2. Relax `/api/audio/[id]` to allow streaming public tracks (`where: { id, OR: [{ ownerId: userId }, { isPublic: true }] }`). Without this, clicking a foreign public track in Discover will 404 on the audio fetch.
3. Relax `/api/cover/[id]` the same way for cover thumbnails.
4. Extend `PATCH /api/songs/[id]` body schema to accept `{ isPublic?: boolean }` so the owner can toggle visibility. The Discover feed will be empty until at least one track is flipped to `isPublic: true`.
5. Wire `<DiscoverView onPlay={(song) => usePlayerStore.getState().playSong(song)} />` into `page.tsx` (probably under a new `SidebarView` value `"discover"` — the sidebar already has `Compass` imported for it).

## Integration TODO for orchestrator
- Add `"discover"` to the `SidebarView` union in `src/components/music/app-sidebar.tsx` (the `Compass` icon is already imported there).
- Render `<DiscoverView onPlay={...} />` in `page.tsx` when `view === "discover"`.
- Pass `onPlay={(song) => usePlayerStore.getState().playSong(song)}` (or whatever the existing play handler is — same one SongCard/TrackList use).
