# Agent C-3 — Lyrics Editor

Task ID: C-3
Agent: c-3 (lyrics-editor)
Files owned:
- `src/app/api/songs/[id]/lyrics/route.ts` (new)
- `src/components/music/lyrics-editor.tsx` (new)

## Goal
Let users edit the lyrics of an existing track they own (SpotiBot/Spotify-like app).

## API contract
`PATCH /api/songs/[id]/lyrics`
- Auth required via `getCurrentUserId` from `@/lib/session`.
- Body: `{ lyrics: string }`, zod-validated, trimmed, 0..5000 chars.
- Scoped by `ownerId` — only the song's owner can edit. Missing id and
  foreign-owned id both surface as Prisma `P2025` and are collapsed into a
  uniform 404 (no ownership leakage).
- 200 `{ success: true }`, 400 (validation/JSON), 401 (unauth), 404 (not
  found / not owned), 500 (unexpected).

## Component contract (`LyricsEditor`)
Props (exact):
```ts
{
  songId: string;
  initialLyrics: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (newLyrics: string) => void;
}
```
- `"use client"`; uses shadcn `Dialog` + `Textarea` + `Button`.
- `useToast` from `@/hooks/use-toast` for success/error feedback.
- Char counter (max 5000), over-limit guard disables Save + shows error.
- ⌘/Ctrl+Enter saves; ESC closes (Radix default).
- Re-seeds textarea from `initialLyrics` every time the dialog opens
  (discards cancelled edits; picks up external updates).
- Save button shows spinner + "Saving…" while submitting; disabled when
  unchanged, over limit, or submitting.

## Integration notes for downstream agents
- The 5000-char cap is exported from the route as `LYRICS_MAX_CHARS`. The
  component keeps a local `MAX_CHARS = 5000` literal — keep them in sync if
  the cap changes.
- The PATCH endpoint is separate from the existing `PATCH /api/songs/[id]`
  (which only handles `liked`). They coexist under the same `[id]` segment
  as a sibling `lyrics/` sub-route.
- The component is self-contained and does NOT mutate parent state. The
  parent is expected to update its own copy of the song's `lyrics` field
  inside the `onSaved` callback (e.g. via `useSongs`'s helpers or a
  TanStack Query mutation).
- Suggested trigger: a button next to the existing `LyricsPanel` (e.g.
  in `song-detail.tsx` or `lyrics-panel.tsx`). NOT wired in this task —
  out of ownership scope.

## Lint status
`bun run lint` → clean (no errors/warnings on either file).
