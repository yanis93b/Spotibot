# Task 2-D — playlist-dnd

Agent: playlist-dnd
Phase: 2 (SpotiBot)
Status: COMPLETE
Lint: PASS (clean, 0 errors)
TypeScript: PASS (clean for owned files)

## Scope
Build the drag-and-drop reorder feature for the playlist view:
1. A backend API endpoint that rewrites `PlaylistSong.position` values to match a client-supplied ordering.
2. A frontend sortable track list component built on `@dnd-kit/core` + `@dnd-kit/sortable`.

You can read prior agents' work records in `/agent-ctx/` and the architecture log at `/home/z/my-project/worklog.md`.

## Files created (owned — no existing files modified)
| File | Purpose |
|------|---------|
| `src/app/api/playlists/[id]/reorder/route.ts` | `POST /api/playlists/[id]/reorder` — atomic reorder of all `PlaylistSong.position` fields |
| `src/components/music/sortable-track-list.tsx` | dnd-kit-powered `"use client"` sortable track list (GripVertical handle + cover + title + genre/mood + duration) |

## API contract — `POST /api/playlists/[id]/reorder`

### Request
```jsonc
{
  "orderedSongIds": ["song-1", "song-2", "song-3"] // full new order
}
```

### Responses
| Status | Body | When |
|--------|------|------|
| 200 | `{ "success": true }` | positions rewritten atomically |
| 400 | `{ "error": string }` | malformed JSON / zod fail / duplicate id / set mismatch (length or unknown id) |
| 401 | `{ "error": "Unauthorized" }` | no NextAuth session |
| 404 | `{ "error": "Playlist not found" }` | playlist doesn't exist OR doesn't belong to caller (no existence leak) |
| 500 | `{ "error": "Failed to reorder playlist." }` | unexpected (logged server-side) |

### Validation (defense in depth)
1. **Auth**: `getCurrentUserId()` → 401 if null.
2. **Body**: zod schema — `orderedSongIds: string[]` (non-empty array of trimmed non-empty strings).
3. **Dup check**: Set-based, rejects any duplicate id in the body before touching the DB (a playlist can't contain the same song twice given the `[playlistId, songId]` unique constraint).
4. **Ownership**: `db.playlist.findUnique({ where: { id, ownerId: userId } })` → 404 if null (also catches foreign playlists — no existence leak).
5. **Set match**: loads current `PlaylistSong` rows for the playlist, builds a Set of songIds, and asserts the body is the SAME set (same length + every body id is currently in the playlist). Mismatch → 400 with a clear message. This keeps `/reorder` a pure position-rewrite — add/remove still go through `/api/playlists/[id]/tracks`.
6. **Atomic write**: `db.$transaction(orderedSongIds.map((songId, i) => db.playlistSong.update({ where: { playlistId_songId: { playlistId, songId } }, data: { position: i } })))` — either every position is updated or none.
7. **P2025 race guard**: catches a track being removed between the fetch + the transaction (returns 404).

## Component contract — `<SortableTrackList />`

```ts
interface SortableTrackListProps {
  songs: Song[];                                  // current order
  onReorder: (orderedIds: string[]) => void;      // fired with new order after drop
  onPlay: (song: Song) => void;                   // fired when a NEW song is clicked
  currentId?: string;                             // override for "current song id"
  isPlaying: boolean;                             // global play state (drives pause icon)
}
```

### Behavior
- `DndContext` (closestCenter) + `SortableContext` (verticalListSortingStrategy) wrap a `<ul>` of `SortableTrackRow`s.
- **Sensors**: `PointerSensor` with `activationConstraint: { distance: 6 }` (so a click doesn't start a drag) + `KeyboardSensor` with `sortableKeyboardCoordinates` for full a11y (Space to pick up, arrows to move, Enter/Space to drop).
- **Drag handle isolation**: `setActivatorNodeRef` + the sortable `attributes`/`listeners` are spread ONLY on the `GripVertical` button — so clicks elsewhere on the row play the song instead of starting a drag. The handle's `onClick` calls `stopPropagation()` so a handle tap never reaches the row's play handler.
- **Visual feedback during drag**: dnd-kit's `useSortable` returns `transform`/`transition`; we apply them via `CSS.Transform.toString(transform)`. Other rows shift out of the way live (no local state needed for the in-flight ordering). `isDragging` lifts the row (`z-10`, fuchsia ring, `cursor-grabbing`, shadow).
- **On drop**: `handleDragEnd` reads `{ active, over }`, indexes both ids in the current `songs`, `arrayMove`s, and calls `onReorder(next.map(s => s.id))`. The parent owns the API call + the source of truth and re-renders with the updated `songs`.
- **Play state**: reads `current` from `usePlayerStore` as a fallback when `currentId` is omitted; uses the `isPlaying` prop for the play/pause icon. Click on the current row → `store.togglePlay()` (local toggle, no parent round-trip). Click on a new row → `onPlay(song)` (parent wires `store.playSong` + queue). Double-click anywhere on the row also plays.
- **Row layout**: `[GripVertical handle] [#/play button] [cover + title + genre·mood] [style on sm+] [duration]` — mirrors the existing `TrackList` but with the handle prepended. Wrapped in `.glass-card rounded-xl` to match the existing dark-theme panel styling.
- **Cover**: uses the shared `<CoverImage>` component (renders AI PNG from `/api/cover/{id}` or a deterministic gradient fallback, with a 3-bar equalizer overlay when the row is the currently-playing track).

## Parent wiring example (for the playlist view — NOT part of this task)
```tsx
<SortableTrackList
  songs={playlistSongs}
  currentId={currentSong?.id}
  isPlaying={isPlaying}
  onPlay={(song) => {
    // parent decides: set queue, then store.playSong(song)
    playSong(song);
  }}
  onReorder={async (orderedIds) => {
    // optimistic UI optional; parent must POST + refetch
    await fetch(`/api/playlists/${playlistId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedSongIds: orderedIds }),
    });
    await refetchPlaylist();
  }}
/>
```

## Quality gates
- `bun run lint` → **PASS** (0 errors, 0 warnings, whole project).
- `npx tsc --noEmit` → **PASS** for both owned files (pre-existing errors in other agents' files — `examples/websocket`, `skills/image-edit`, `src/app/api/generate`, `src/app/api/history`, `src/components/music/song-card`/`song-detail` — were NOT touched).
- TypeScript strict throughout — no `any`. The `DragEndEvent` type is imported as a type-only import from `@dnd-kit/core`.
- Self-caught + fixed one TS2783: removed my explicit `aria-roledescription="sortable item"` because dnd-kit's `attributes` spread already sets `aria-roledescription` (and `role`/`tabIndex`/`aria-describedby`). Added a comment explaining dnd-kit provides the AT attributes.
- Dev server log shows clean HMR compiles for both new files; no runtime errors introduced.
- Did NOT modify any existing file (no schema change — `PlaylistSong.position` already existed from Task 9).
- Did NOT start/stop the dev server.

## Integration notes for downstream agents
- The reorder endpoint is **pure position-rewrite** — clients must send the FULL new ordering. The endpoint deliberately does NOT add/remove rows; that stays on `/api/playlists/[id]/tracks`. The set-match check enforces this.
- The component is **stateless w.r.t. ordering** — the parent owns `songs`. Optimistic UI is the parent's responsibility (the simplest correct pattern: optimistic `arrayMove` on the parent's `songs` state, then POST, then refetch on success or rollback on error).
- Play actions are split: **current row → `store.togglePlay()` (in-component)**; **new row → `onPlay(song)` (parent callback, typically wires `store.playSong` + queue)**. This avoids the parent having to detect "is this the current song?" in its onPlay handler.
