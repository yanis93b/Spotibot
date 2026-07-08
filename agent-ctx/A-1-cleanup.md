# Task A-1 — Delete obsolete music components + fix broken imports

**Agent:** A-1 (cleanup)
**Phase:** cleanup pass on the SpotiBot codebase
**Task ID:** A-1

## Goal

Remove 8 obsolete music components that accumulated across iterations as newer
replacements landed, then ensure no broken imports remain and `bun run lint`
passes clean.

## Files deleted (8, all genuinely dead)

| File                         | Superseded by                                  |
|------------------------------|------------------------------------------------|
| `site-header.tsx`            | `top-bar.tsx` + `app-sidebar.tsx`              |
| `site-footer.tsx`            | (no longer used)                               |
| `song-player.tsx`            | `bottom-player.tsx`                            |
| `song-history.tsx`           | `track-list.tsx`                               |
| `song-card.tsx`              | `track-list.tsx` + `cover-image.tsx`           |
| `song-feed.tsx`              | `track-list.tsx` + `browse-view.tsx`           |
| `song-detail.tsx`            | `now-playing-panel.tsx`                        |
| `empty-state.tsx`            | inline empty states (e.g. `EmptyHint` in `profile-view.tsx`) |

## Import audit (pre-deletion)

Two complementary greps across the whole repo (excluding `node_modules`):

1. Loose substring search for each of the 8 module names.
2. Strict `from "...<module>"` import-path search.

Findings — only TWO import statements in the entire project referenced any of
the 8 files, and BOTH were intra-dead-set (a to-be-deleted file importing
another to-be-deleted file):

```
src/components/music/song-player.tsx:20  → import { EmptyState } from "./empty-state";
src/components/music/song-feed.tsx:8     → import { SongCard } from "./song-card";
```

**No active code imported any of the 8 files.** The earlier loose-name hits in
`profile-view.tsx` were false positives — the strings "empty-state" /
"song-player" there are inside a JSDoc comment ("Compact empty-state hint…")
and the local function name `EmptyHint`, not actual ES-module imports.

## Files NOT touched

- `src/app/page.tsx` — orchestrator-owned per task instructions.
- All other components, API routes, schemas, configs, mini-services.
- Did NOT start/stop the dev server.

## Verification

- `cd /home/z/my-project && bun run lint` → **EXIT 0, 0 errors / 0 warnings**
  project-wide. No broken-import errors surfaced, confirming the audit.
- `tail` of `/home/z/my-project/dev.log` → Next.js dev server recompiled
  cleanly ("✓ Compiled in 260ms" / "✓ Compiled in 238ms") after the deletions;
  no `ModuleNotFound` / compile errors attributable to the removed files. Only
  routine Prisma query logs + 200 responses on `/api/browse`, `/api/stats`,
  `/api/songs`, `/api/profile/me`, `/api/health/ace`.

## Broken imports fixed

None needed. The only two cross-references among the 8 files (song-player →
empty-state, song-feed → song-card) disappeared with the deletions themselves.

## Notes for the orchestrator / future agents

- `src/components/music/` is now down to 28 files (was 36).
- If any future agent re-introduces an `EmptyState` / `SongCard` /
  `SongPlayer` symbol, they must create a NEW component — these names are
  free now and the old implementations are gone from git history only.
- No `page.tsx` edit was required; the orchestrator's current `page.tsx`
  already wires the newer replacements (`TopBar` + `AppSidebar`,
  `BottomPlayer`, `TrackList`, `NowPlayingPanel`, etc.).
