# Agent Context — Task 1 (frontend-ui-ux)

This file is a quick reference for downstream agents. The full work log is
appended to `/home/z/my-project/worklog.md`.

## Files I own (created/modified)
- `src/app/page.tsx` — rewritten as the main client orchestration page.
- `src/app/globals.css` — appended music-theme utilities (`.music-bg`,
  `.gradient-text`, `.glass-card`, custom scrollbar, focus rings, keyframes).
  The original Tailwind imports + theme vars at the top are untouched.
- `src/components/music/site-header.tsx`
- `src/components/music/site-footer.tsx`
- `src/components/music/prompt-composer.tsx`
- `src/components/music/song-player.tsx`
- `src/components/music/song-history.tsx`
- `src/components/music/equalizer-bars.tsx`
- `src/components/music/lyrics-panel.tsx`
- `src/components/music/generation-loader.tsx`
- `src/components/music/empty-state.tsx`
- `src/hooks/use-songs.ts` — optional client data hook (initial fetch +
  optimistic prepend/remove/restore helpers).

## Frontend ↔ Backend contract confirmed
- `POST /api/generate` body `{ prompt, genre, mood, style, voice? }` → `Song`.
- `GET /api/songs` → `{ songs: Song[] }`.
- `DELETE /api/songs/{id}` → `{ success: true }`.
- `GET /api/audio/{id}` → streamed `audio/mpeg`; used directly as
  `<audio src>` and as the `download` link.

## Notes for backend agents (Agent 2 / Agent 3)
- The audio element uses `preload="metadata"`. The server should send a
  `Content-Length` and standard `audio/mpeg` MIME so duration metadata fires.
- Download link uses `<a href={song.audioUrl} download={`${title}.mp3`}>`.
  A `Content-Disposition: attachment` header on `/api/audio/{id}` would
  improve download UX but is not required (browser falls back to navigation).
- The loader can show for 10–20s; the cycle text in `generation-loader.tsx`
  is purely cosmetic, not wired to real progress events.

## Lint status
`bun run lint` passes cleanly for all files I own (zero warnings/errors).

## Observed runtime
Dev log shows successful `POST /api/generate 200 in 16.7s` (after an earlier
audio-synth 500 that Agent 3 has since resolved). Frontend renders `GET / 200`
and `GET /api/songs 200` consistently. No frontend runtime errors observed.
