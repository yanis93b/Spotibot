# Agent Context — Task C-1 (synced-lyrics)

Karaoke-style synced lyrics component for the SpotiBot/AceMusic player.

## Files I own (created)
- `src/lib/lyrics-timestamps.ts` — `estimateLineTimestamps(lyrics, durationMs)`
  + `findActiveLineIndex(lines, currentTime)` + `LyricLine` type.
- `src/components/music/synced-lyrics.tsx` — `<SyncedLyrics>` client
  component (default + named export).

## Public API

### `lyrics-timestamps.ts`
```ts
export interface LyricLine {
  text: string;        // trimmed
  startTime: number;   // seconds from track start
  isSection: boolean;  // true for [Verse]/[Chorus]/… headings
}

export function estimateLineTimestamps(
  lyrics: string,
  durationMs: number,
): LyricLine[]

export function findActiveLineIndex(
  lines: LyricLine[],
  currentTime: number,
): number  // -1 when nothing is active yet
```

Algorithm:
1. Split on `\n`; drop blank lines (not rendered, not timed).
2. Classify each non-blank line as section (`/^\[[^\]]+\]$/`) or singable.
3. Distribute `durationMs` EVENLY across only the singable lines.
4. Section headings adopt the timestamp of the following singable line
   (they consume no time) so the active-line finder never lands on a heading.

### `synced-lyrics.tsx`
```tsx
export interface SyncedLyricsProps {
  lyrics: string;
  durationMs: number;
  currentTime?: number;  // optional override; defaults to player store
  className?: string;
}
export function SyncedLyrics(props: SyncedLyricsProps): JSX.Element
```

Behaviour:
- `"use client"` — required for `usePlayerStore` + refs/effects.
- Reads `currentTime` and `duration` from `usePlayerStore` (the shared
  Zustand player store). Live store values take precedence over the props
  when a track is loaded (`storeTime > 0`, `storeDuration > 0`), so karaoke
  highlighting tracks real playback without the parent re-rendering on every
  `timeupdate` event. Props are the fallback (e.g. for unit tests or a
  static preview).
- Active line = last non-section line with `startTime <= currentTime`.
- Active line styling: `text-lg font-bold text-fuchsia-400` + a fuchsia
  `drop-shadow` glow + `opacity-100`.
- Past lines: `opacity-50`.
- Future lines: `text-foreground/80`, normal opacity.
- Section tags: `text-xs font-semibold uppercase tracking-[0.18em]
  text-muted-foreground/60` — never highlighted, never active.
- Auto-scroll: `useEffect` on `activeIndex` scrolls the active `<p>` to the
  vertical center of the scroll container via
  `container.scrollTo({ top, behavior: "smooth" })`. Only fires when the
  active index actually changes (a few times per song), so no jank.
- Container: `max-h-96 overflow-y-auto`, inherits the global custom
  fuchsia-on-dark scrollbar from `globals.css`. Adds a top/bottom
  `mask-image` linear-gradient fade for the karaoke drift-in/out effect.
- Empty state: renders "No lyrics available for this track." inside the
  same scroll container shell.

## Integration notes for the player owner (Agent 1 / song-player.tsx)
- Drop-in replacement for the static `<LyricsPanel>` inside the player's
  expandable lyrics section, e.g.:
  ```tsx
  <SyncedLyrics
    lyrics={song.lyrics}
    durationMs={song.durationMs}
  />
  ```
  No need to pass `currentTime` — the component reads it from the player
  store automatically. Pass it only if you want a static (non-live) preview.
- The component is purely presentational and owns no audio state; it just
  subscribes to the existing `usePlayerStore`. Safe to mount/unmount per
  song (refs + memos reset cleanly).
- Marked `"use client"` — must be rendered inside a client boundary (the
  player already is).

## Lint status
`bun run lint` — both owned files are CLEAN (0 errors, 0 warnings).
TypeScript `tsc --noEmit` — both owned files pass with no diagnostics.

NOTE: `bun run lint` reports 1 error in `src/hooks/use-radio.ts`
(`react-hooks/set-state-in-effect`) — that file is owned by the 4-A PWA
agent, NOT in my file set. I did not touch it.

## Styling decisions
- Accent palette: fuchsia-400 active line (matches the existing
  `.gradient-text` / `.glass-card` / custom scrollbar fuchsia theme in
  `globals.css`). No indigo/blue introduced.
- Section heading color uses the shadcn `muted-foreground` token so it
  adapts to light/dark themes automatically.
- Animations are CSS `transition-all duration-300 ease-out` only — no
  framer-motion dependency added (kept the import surface minimal).
- `prefers-reduced-motion` is NOT explicitly handled here, but the only
  motion is the smooth-scroll + 300ms color/size transition, which is
  subtle enough to be safe. The global `globals.css` reduced-motion guard
  covers the keyframed animations elsewhere.
