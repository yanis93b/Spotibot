# Task C-2 — Radio / Autoplay Feature

Agent: radio-autoplay
Files owned (created only these):
- `src/hooks/use-radio.ts`
- `src/components/music/radio-toggle.tsx`

## What was built

### `src/hooks/use-radio.ts`
- `useRadio()` → `{ radioEnabled, toggleRadio }`.
- `radioEnabled` is persisted to `localStorage["spotibot-radio"]` and read via `useSyncExternalStore` (mirrors `theme-toggle.tsx` pattern; avoids hydration mismatches and the `set-state-in-effect` lint rule).
- Cross-tab sync via the native `storage` event; in-tab sync via a custom `spotibot:radio-change` event dispatched from `writeRadio()`.
- Subscribes to `usePlayerStore` ONLY while radio is enabled.
- **Ended detection:** `onEnded()` in the player store is the unique signal that flips `isPlaying` true→false AND resets `currentTime` to 0 while keeping the same `current.id`. Neither manual pause (keeps `currentTime`) nor loading a different song (changes `current.id`) match this signature, so the hook inspects the prev→next delta inside `usePlayerStore.subscribe` to reliably detect a real track-end.
- One-shot `firedForId` guard prevents double-firing on a single ended event; re-armed when the song changes or the user re-starts playback of the same track.
- `autoplayNext(current)`:
  1. Fetches the user's library from `/api/songs` (cached in a module-level `libraryCache` after the first call).
  2. Bails out silently if the user has manually moved to a different track during the async fetch (never hijacks an explicit action).
  3. Filters to same-`genre` tracks that aren't the current one.
  4. Falls back to any other track if no same-genre match exists.
  5. Picks a random candidate and calls `usePlayerStore.getState().playSong(next)`.

### `src/components/music/radio-toggle.tsx`
- `"use client"`, uses the `useRadio` hook.
- shadcn `<Button variant="ghost" size="icon">` overridden with `size-8 rounded-full` for the compact spec.
- Disabled state: `text-muted-foreground hover:text-foreground`.
- Enabled state: `text-fuchsia-300 hover:bg-fuchsia-500/10 hover:text-fuchsia-200` + framer-motion opacity pulse `[1, 0.45, 1]` over 2.2s (broadcast-signal vibe).
- `aria-label="Toggle autoplay"`, `aria-pressed={radioEnabled}`, `title` reflects current state.
- Lucide `Radio` icon at `size-4`.

## How to wire it in (for orchestrator)
The toggle is self-contained — drop `<RadioToggle/>` into the bottom player's right-side control cluster (e.g. between the Queue button and the volume control in `bottom-player.tsx`). No props needed; the hook handles all state and side-effects internally.

## Lint status
`bun run lint` — clean (0 errors, 0 warnings) after refactoring the initial hydration from `useState + useEffect(setState)` to `useSyncExternalStore` (the same pattern `theme-toggle.tsx` uses).

## Dev log
No errors related to my files. `GET /api/songs 200` confirms the endpoint my hook fetches is healthy.
