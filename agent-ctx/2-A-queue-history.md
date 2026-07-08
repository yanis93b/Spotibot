# Task: 2-A — queue-history

Agent: queue-history
Status: COMPLETE
Lint: PASS (clean — `bun run lint` runs without errors or warnings)

## Scope
Phase 2 of SpotiBot. Built the **persistent play queue** (Zustand) and the
**listening history** API (Prisma-backed, scoped per user).

## Files created (and ONLY these — no existing files modified)

| File | Purpose |
|------|---------|
| `src/lib/queue-store.ts` | Zustand queue store with next/prev, add to queue, add next, clear, reorder; integrates with `usePlayerStore` |
| `src/app/api/history/route.ts` | `GET` list (newest first, max 50) + `POST` add `{ songId }`, both scoped by `ownerId` via `getCurrentUserId()` |
| `src/app/api/history/[id]/route.ts` | `DELETE` a single history entry, scoped by `ownerId` (404 on P2025) |
| `src/components/music/queue-panel.tsx` | Slide-in right panel: "Next up" header, DnD-reorderable list of upcoming tracks, remove + Clear, glassmorphism |
| `src/components/music/queue-button.tsx` | Compact bottom-player button with `ListMusic` icon + fuchsia badge showing queue count |
| `prisma/schema-history.md` | Documents the `ListeningHistory` model + back-relations to merge into `prisma/schema.prisma` (orchestrator job) |

## Architecture decisions

### Queue store (`src/lib/queue-store.ts`)
- **`queue: Song[]`** holds the *full* ordered queue (including the current
  track); **`currentIndex`** points at the playing track (-1 = empty). This
  matches Spotify semantics and makes `next()`/`prev()` trivial index bumps.
- **Integration with `usePlayerStore`**: the queue store never touches the
  `<audio>` element directly. Whenever `playFrom`, `next`, or `prev` advance
  the current track, it calls `usePlayerStore.getState().playSong(song)` —
  the player store remains the single owner of the media element. We use
  `getState()` (non-reactive) so the queue store doesn't subscribe to player
  updates; the two stores are independent concerns.
- **`addToQueue` / `playNext` fast path**: when the queue is empty
  (`currentIndex < 0`), enqueuing a song immediately starts playing it
  rather than silently queuing. Matches Spotify's behavior.
- **`removeFromQueue`** adjusts `currentIndex` to stay valid but does NOT
  auto-advance the player when the current track is removed — the user can
  explicitly skip; we only fix the index so the queue UI stays sane.
- **`reorderQueue(from, to)`** tracks the currently-playing song through the
  move (3 cases: current was the dragged item, current was passed by an
  earlier item, current was passed by a later item).
- Convenience hooks **`useCurrentQueueSong()`** and **`useUpcomingSongs()`**
  provide reactive selectors so components don't have to reach into the
  raw state shape.

### Listening history API
- **`GET /api/history`** — `findMany({ where: { userId }, orderBy: { playedAt: "desc" }, take: 50, include: { song: true } })`, mapped to `{ id, playedAt, song }[]`. The compound index `@@index([userId, playedAt])` (declared in schema-history.md) makes this an index-only scan.
- **`POST /api/history`** — zod-validates `{ songId }`, then verifies the
  song belongs to the caller (`findUnique({ where: { id, ownerId: userId } })`)
  before creating the history row. Defense in depth — never log plays of
  songs the user doesn't own. Returns the created entry with status 201.
- **`DELETE /api/history/[id]`** — `delete({ where: { id, userId } })`, scoped
  by `ownerId`. A non-owned id yields a 404 via Prisma P2025 — no existence
  leakage, consistent with the api-scoping agent's pattern.
- All three handlers use the Next.js 16 async `params: Promise<{ id: string }>`
  signature for the `[id]` route, and `export const dynamic = "force-dynamic"`
  (history changes on every play, so caching would show stale data).

### Queue panel (`queue-panel.tsx`)
- Slide-in from the right via Framer Motion (`x: "100%" → 0`). A
  semi-transparent scrim with `backdrop-blur-sm` closes the panel on click.
- Shows only **upcoming tracks** (`queue[currentIndex+1..]`); the current
  track is already shown in the bottom player so we don't repeat it.
- **Drag-and-drop** via `@dnd-kit/core` + `@dnd-kit/sortable`:
  - `PointerSensor` with `activationConstraint: { distance: 4 }` so a stray
    click on the drag handle doesn't start a drag.
  - Sortable id = stringified absolute queue index (always unique within a
    render; after a reorder the indices shift but the drag is already done).
  - Only the `GripVertical` handle is a drag trigger (`{...attributes} {...listeners}`),
    leaving the cover/meta click area free for future "jump to track" actions.
  - On `DragEnd`, calls `reorderQueue(from, to)` with the absolute indices.
- Each row: drag handle, `CoverImage`, title + meta, remove (X) button.
- Header has a `Clear` action (visible only when the queue is non-empty)
  that calls `clearQueue()`.
- Empty state: icon + "Your queue is empty" hint.
- Dark theme + glassmorphism: `bg-[#0a0a0f]/95 backdrop-blur-xl`,
  `border-white/[0.06]`, matches the existing `.glass-card` aesthetic.

### Queue button (`queue-button.tsx`)
- Purely presentational. Props: `count`, `active`, `onToggle`.
- `ListMusic` icon; fuchsia badge with the upcoming count (hidden when 0,
  caps at "99+"). Ring matches the bottom player's dark bg (`ring-[#050507]`)
  so the badge looks like a floating chip, not a square block.
- Lights up to `text-fuchsia-300` when `active` so the user gets feedback
  that the panel is open.

### Prisma schema addendum (`prisma/schema-history.md`)
- Documents the new `ListeningHistory` model exactly as specified in the
  task (`id`, `userId`, `songId`, `playedAt`, relations with
  `onDelete: Cascade`, `@@index([userId, playedAt])`).
- Documents the back-relations `history ListeningHistory[]` to add to both
  `User` and `Song`.
- Does NOT modify `prisma/schema.prisma` — orchestrator merges + runs
  `bun run db:push`.

## For downstream agents / integrator

- **Wiring the bottom player**: replace the existing placeholder queue
  button in `src/components/music/bottom-player.tsx` with `<QueueButton>`,
  and render `<QueuePanel>` alongside the player. The integration point
  already exists in `bottom-player.tsx` (there's a ListMusic button in the
  right-side controls at lines 220-227). A parent component (e.g. `page.tsx`)
  should own the `queueOpen` state and pass `onToggle`/`onClose` down.
- **Wiring the player's `onEnded`**: the bottom player already calls
  `onNext` when `<audio>` fires `ended`. Point that at
  `useQueueStore.getState().next` (or wrap it) so finishing a track
  auto-advances the queue.
- **Wiring the transport buttons**: the bottom player's prev/next buttons
  should call `useQueueStore` `prev`/`next` so they drive the queue instead
  of just being no-ops.
- **Recording history**: when a song starts playing (e.g. inside
  `useQueueStore.playFrom` / `next` / `prev` after the call to
  `playerStore.playSong`), POST to `/api/history` with `{ songId }`. The
  queue store does NOT do this itself to keep it free of network concerns;
  the integrator can either add a `useEffect` that watches
  `usePlayerStore.current?.id` and POSTs, or wire it in at the call sites.
- **Prisma schema MUST be merged before the history API compiles**: until
  the orchestrator merges `schema-history.md` into `prisma/schema.prisma`
  and runs `bun run db:push`, `db.listeningHistory` will not exist on the
  Prisma Client. The route files are written correctly against the future
  schema; lint passes because ESLint doesn't deep-type-check Prisma client
  field access.
