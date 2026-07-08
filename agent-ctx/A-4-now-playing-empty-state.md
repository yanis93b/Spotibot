# A-4 — Now Playing panel empty-state redesign

**Agent:** now-playing-empty-state
**Task ID:** A-4
**File owned & modified:** `src/components/music/now-playing-panel.tsx` (only this file)

## Goal
The right-side "Now Playing" panel showed a boring muted `Music2` icon + "Select a track to see its cover, lyrics, and details here." placeholder when no track was selected. Replace it with an intentional, on-brand SpotiBot empty state. Also verify the playing state renders correctly and that the lyrics area scrolls.

## What I read first
- `/home/z/my-project/worklog.md` — full architecture, file-ownership rules, dark-glass + fuchsia-accent UI conventions established by earlier agents, the shared `Song` type, `usePlayerStore` selector usage, shadcn + Framer Motion conventions.
- `src/components/music/now-playing-panel.tsx` — the file I own. Two-branch render: empty state + playing state. Playing state already renders CoverImage (308px), title + like, AttrChips, download pill, prompt block, and a `max-h-64 overflow-y-auto` lyrics container.
- `src/components/music/cover-image.tsx` — confirmed plain `<img>` is the established pattern in this codebase (so using `<img>` for the static brand PNG won't trip ESLint's `@next/next/no-img-element`).
- Verified `/public/spotibot-brand.png` exists (56 KB).

## Changes made (all in `src/components/music/now-playing-panel.tsx`)

### 1. Empty-state branch — full redesign
- Wrapper `<aside>` is now `relative overflow-hidden` with:
  - A fuchsia-leaning gradient: `bg-gradient-to-b from-[#1c1428] via-[#15101f] to-[#0f0f15]`.
  - `border-fuchsia-500/10` so the panel reads as SpotiBot-branded even before any track loads.
- Two stacked decorative radial-gradient overlays (`pointer-events-none absolute inset-0`, `aria-hidden`):
  - Fuchsia glow anchored top-center: `radial-gradient(circle_at_50%_28%, rgba(217,70,239,0.22), transparent 58%)`.
  - Violet glow anchored toward the bottom: `radial-gradient(circle_at_50%_78%, rgba(139,92,246,0.16), transparent 55%)`.
- Centered content stack: `flex flex-1 flex-col items-center justify-center gap-5 text-center`.
- **Logo with pulsing glow** — `relative grid place-items-center` wrapper containing:
  - Inner pulsing fuchsia glow: `motion.span` with `bg-fuchsia-500/40 blur-2xl`, animated `opacity:[0.4,0.75,0.4]` + `scale:[1,1.12,1]` over 2.8s `easeInOut` infinite repeat.
  - Secondary violet halo: `motion.span` with `bg-violet-500/25 blur-xl`, `inset-[-6px]`, animated `opacity:[0.25,0.55,0.25]` + `scale:[1.05,1.18,1.05]` over 3.4s with 0.3s delay — so the two glows breathe out of phase (aurora effect, never strobes).
  - The brand image: `<motion.img src="/spotibot-brand.png" width={80} height={80}>` rendered as an 80px (`size-20`) `rounded-2xl object-contain ring-1 ring-white/10` tile, with a one-shot `opacity/scale` entrance (`0.9 → 1`, 0.45s `easeOut`) on mount.
- **Heading** "SpotiBot": `bg-gradient-to-r from-fuchsia-300 via-pink-200 to-violet-300 bg-clip-text text-transparent`, `text-xl font-bold tracking-tight`.
- **Subtitle**: exact existing copy "Select a track to see its cover, lyrics, and details here." in `text-sm leading-relaxed text-muted-foreground`, capped at `max-w-[240px]` for clean wrapping inside the 340px panel.
- The "Now Playing" eyebrow label is kept (made `relative` so it sits above the absolute glows) so the empty state still reads as the Now Playing panel — just intentional instead of placeholder-y.

### 2. Playing-state branch — verified + small UX polish
- Verified unchanged structure renders correctly: `CoverImage` (308px, full-width, equalizer overlay when `isPlaying && currentId === song.id`), title+like row (`flex items-start justify-between gap-2`, `truncate text-lg font-bold`), AttrChips (`flex flex-wrap gap-2`), download pill, optional prompt block (`rounded-md border bg-black/20 p-3`), scrollable lyrics block. Spacing already uses `gap-4` + `mb-3` which reads well.
- Enhanced the lyrics scrollbar per the UI rules ("implement custom scrollbar styling for better appearance"). The existing `max-h-64 overflow-y-auto` container now also carries Tailwind arbitrary-variant styling:
  - ``
  - ``
  - ``
  - Purely cosmetic — no layout change. Long lyrics still scroll within the panel.

## Imports / types
- No import changes. `Music2` is still used by the audioFormat `AttrChip` in the playing state, so the existing lucide import list stays accurate.
- No type/signature changes. `NowPlayingPanelProps` (`{ song: Song | null; onToggleLike: (id: string) => void }`) unchanged.

## Lint / type-check
- `cd /home/z/my-project && bun run lint` → EXIT 0, 0 errors / 0 warnings project-wide.
- No new dev.log compile errors attributed to `now-playing-panel.tsx`.

## Files touched
- `src/components/music/now-playing-panel.tsx` (only this file)
- `/home/z/my-project/worklog.md` (appended the A-4 entry)
- `/home/z/my-project/agent-ctx/A-4-now-playing-empty-state.md` (this work record)

## Out of scope (not touched)
- Any other component, the schema, types, API routes, layout, globals.css, or the dev server. The orchestrator's TODOs documented by earlier agents are unaffected.
