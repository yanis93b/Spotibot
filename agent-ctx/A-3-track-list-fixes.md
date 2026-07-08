# Agent Context — Task A-3 (track-list visual fixes)

This file is a quick reference for downstream agents. The full work log is
appended to `/home/z/my-project/worklog.md` under "Task A-3".

## File I own (modified)
- `src/components/music/track-list.tsx` — fixed 4 visual bugs (column header
  alignment, currently-playing row distinctness, cover hover play overlay,
  duration right-alignment).

## Bugs fixed
1. **Column header alignment** — header, skeleton, and row now share a single
   module-scope `GRID` constant:
   `"grid grid-cols-[2rem_1fr_5rem] items-center gap-4 sm:grid-cols-[2rem_1fr_minmax(0,180px)_3rem_6.5rem]"`.
   - Mobile: `2rem_1fr_5rem` (was `2rem_1fr_auto` — `auto` made col 3 width
     differ between header's Clock icon and row's duration+more).
   - Desktop: last column `3rem → 6.5rem` so `[download + more + duration +
     2×gap]` (~5.5rem) fits without overflowing and pushing the column wider
     than the header.
   - Skeleton rows now have placeholders for all 5 columns (previously only 3
     children → empty cols 4–5 on desktop).
2. **Currently-playing row** — `bg-white/[0.08]` → `bg-fuchsia-500/[0.10]`
   plus a 2px fuchsia left accent bar:
   ```tsx
   {isCurrent && (
     <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-l-md bg-fuchsia-400" />
   )}
   ```
   Absolute-positioned (not `border-l-2`) so it overlays without consuming
   2px of layout width — keeps header and row pixel-aligned. Added `relative`
   to `<motion.li>` so the bar anchors correctly.
3. **Cover hover play overlay** — wrapped `<CoverImage>` in `relative
   shrink-0` span; added a sibling overlay with `group-hover:opacity-100` +
   `pointer-events-none`. Gated on `!showPause` so it never fights the
   CoverImage equalizer overlay. Hovering ANY part of the row reveals it
   (not just the `#` cell).
4. **Duration right-alignment** — reordered the duration cell's flex children
   from `[download] [duration] [more]` → `[download] [more+menu] [duration]`
   so the duration text sits at the column's right edge, directly under the
   header's Clock icon. The more menu moved inside a `relative grid
   place-items-center` wrapper around the more button so the dropdown's
   `absolute bottom-full right-0` still anchors to the button.

## What I did NOT touch
- No other component files. The active-chip-state bug in the composer
  (mentioned in the task brief) was explicitly out of scope — different file.
- No schema, no API routes, no lib, no globals.css, no types.
- Did NOT start/stop the dev server.

## Notes for downstream agents
- The `GRID` constant is module-scope (not exported). If another component
  needs the same template, duplicate it — the grid is intentionally
  co-located with the row markup so they evolve together.
- The cover-hover overlay is local to the track list. If the same affordance
  is wanted in `song-card.tsx` / `song-detail.tsx` / carousels, those
  components should add their own overlay (do NOT add a `hoverPlay` prop to
  `CoverImage` — that component is owned by Agent 1 and is intentionally
  minimal).
- The 2px left accent uses an absolute span rather than `border-l-2` to
  avoid a 2px layout shift between header and row. If any future agent adds
  a left border to the row for another reason, account for the 2px or
  switch this accent to a border.

## Lint / TypeScript status
- `bun run lint` → EXIT 0, 0 errors, 0 warnings.
- `npx tsc --noEmit` → 0 errors in `track-list.tsx`. (Pre-existing errors in
  `examples/`, `skills/`, `src/app/api/generate/route.ts` are in other
  agents' files — untouched.)
- Dev log: clean compiles, no errors attributed to my file.
