# Task: 3-B — Public track sharing (share page + share dialog + standalone player)

Agent: share-embed
Task ID: 3-B
Phase: 3 of SpotiBot
Status: COMPLETE
Lint: PASS (0 errors in owned files; 2 pre-existing warnings in profile-view.tsx, not owned)
TypeScript: PASS (0 errors in owned files; many pre-existing errors in other agents' files)

## Scope
Create the public track-sharing surface: a PUBLIC (no-auth) read API for a single
track's metadata + audio + cover, a share modal (link copy + social + embed code),
and a standalone player component for the `/track/[id]` share page.

## Files created (all owned, no overlap)
| File | Purpose |
|------|---------|
| `src/app/api/track/[id]/route.ts` | `GET` public track metadata (no auth, no owner info) |
| `src/app/api/track/[id]/audio/route.ts` | `GET` public audio stream (no auth) |
| `src/app/api/track/[id]/cover/route.ts` | `GET` public cover image stream (no auth) |
| `src/components/music/share-dialog.tsx` | Share modal: URL + copy + social + embed |
| `src/components/music/track-embed.tsx` | Standalone player for `/track/[id]` |

## API contract

### `GET /api/track/[id]` — PUBLIC (no auth)
Returns the shareable metadata for a single track. Deliberately omits ALL
owner-identifying fields (`ownerId`, `prompt`, `voice`, `liked`, `seed`, `bpm`,
`keyScale`, `timeSignature`, `audioFormat`) so a visitor with only the share link
cannot learn anything about the user who generated the track.

Response shape (exported as `PublicTrack` from the route file):
```ts
interface PublicTrack {
  id: string;
  title: string;
  lyrics: string;
  genre: string;
  mood: string;
  style: string;
  audioUrl: string;       // "/api/track/{id}/audio"
  coverUrl: string | null; // "/api/track/{id}/cover" or null
  durationMs: number;
  createdAt: string;       // ISO 8601
}
```

Status codes:
- `200` — `PublicTrack` JSON (`Cache-Control: public, max-age=300, s-maxage=600`)
- `404` — `{ error: "Track not found" }`
- `500` — `{ error: "Failed to load track." }`

Implementation notes:
- Uses Prisma `select` to fetch ONLY the fields needed for `PublicTrack`, so a
  future schema addition cannot accidentally leak through this route.
- `export const dynamic = "force-dynamic"` (matches the existing API convention).
- Privacy model: the cuid track id (~4.5e31 possibilities) IS the share secret.
  There is no separate "public" flag on the Song row.

### `GET /api/track/[id]/audio` — PUBLIC (no auth)
Streams the stored audio bytes. Public counterpart of the auth-protected
`/api/audio/[id]` route — same byte-streaming + Content-Disposition +
Cache-Control pattern, but no `ownerId` scoping.

Headers on 200:
- `Content-Type`: derived from `song.audioFormat` (audio/mpeg, audio/wav, …) via
  a local `mimeForFormat()` helper (duplicated from the auth route to keep this
  file self-contained within my ownership set).
- `Content-Length`: byte length as string.
- `Content-Disposition`: `inline; filename="<slugified-title>.<ext>"`.
- `Cache-Control`: `public, max-age=3600, immutable`.

Status: `200` binary | `404 { error: "Track not found" }` | `500`.

### `GET /api/track/[id]/cover` — PUBLIC (no auth)
Streams the AI-generated cover PNG. Public counterpart of `/api/cover/[id]`.
Returns `404` when the track has no cover (the player renders a gradient fallback).

Headers on 200: `Content-Type: image/png`, `Content-Length`, `Cache-Control: public, max-age=86400, immutable`.

## Component contracts

### `<ShareDialog />` — `src/components/music/share-dialog.tsx`
Props (exactly per spec):
```ts
interface ShareDialogProps {
  trackId: string;
  trackTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Features:
- **Share link**: readonly `<Input>` showing `{origin}/track/{trackId}`, with a
  gradient "Copy" button that uses `navigator.clipboard.writeText` (with a
  legacy `document.execCommand("copy")` fallback for non-secure HTTP contexts).
  On success, the button turns emerald with a Check icon for 2.2s, then reverts.
- **Social buttons**: 3-column grid of `Twitter` (X), `Facebook`, `MessageCircle`
  (WhatsApp) icons. Each calls `window.open(url, "share-dialog", "width=600,…")`
  with a centered popup. URLs:
  - X: `https://twitter.com/intent/tweet?text=Check out "TITLE" on SpotiBot&url=…`
  - Facebook: `https://www.facebook.com/sharer/sharer.php?u=…`
  - WhatsApp: `https://wa.me/?text=Check out "TITLE" on SpotiBot: URL`
- **Embed code**: readonly `<Textarea>` (4 rows, monospace) pre-filled with:
  ```html
  <iframe src="{ORIGIN}/track/{ID}" width="100%" height="380" frameborder="0"
          allow="autoplay; encrypted-media" loading="lazy" title="{TITLE}"></iframe>
  ```
  with a "Copy embed" link button above it.

Key implementation decisions:
- `origin` is read via `useSyncExternalStore(() => () => {}, () => window.location.origin, () => "")`
  — SSR-safe (returns "" on server), no `setState`-in-effect (avoids the
  `react-hooks/set-state-in-effect` lint error), and the no-op subscribe is
  correct because origin never changes during a page session.
- The copy/social state (`linkCopied`, `embedCopied`, `copyFailed`) lives in a
  `ShareDialogBody` child component rendered inside Radix `DialogContent`. Radix
  unmounts `DialogContent` when the dialog closes, so the body remounts on each
  open — naturally resetting the "Copied!" flags WITHOUT an effect (also avoids
  the lint error).
- Uses the shadcn `Dialog`, `Input`, `Textarea`, `Button` primitives.
- Accent palette: fuchsia→purple→rose gradient (matches the app), emerald for
  "Copied!" success, rose for errors. No indigo/blue.

### `<TrackEmbed />` — `src/components/music/track-embed.tsx`
Props:
```ts
interface TrackEmbedProps {
  track: PublicTrack;  // imported via `import type` from the route file
}
```

A self-contained full-screen player (`min-h-screen flex items-center justify-center`)
for the public share page. Layout:
- Glass card (`max-w-md rounded-3xl p-6 sm:p-8`) centered on `bg-[#050507]`.
- Large 320px square `CoverImage` (reuses the shared component — handles AI PNG
  + gradient fallback + equalizer overlay when playing).
- Track title (truncate, `text-xl sm:text-2xl font-bold`).
- Genre/Mood/Style badges (shadcn `Badge`, filtered to non-empty values).
- Seek bar: shadcn `Slider` with `mm:ss` time labels on both sides, bound to
  the player store's `currentTime` / `duration` / `beginSeek` / `endSeek`.
- Large 64px play/pause button (fuchsia→purple→rose gradient) centered.
- Action row: Download (`<a download>` pointing at `track.audioUrl`) + Share
  (opens `<ShareDialog>`).
- Collapsible Lyrics section (collapsed by default; only renders if
  `track.lyrics` is non-empty) — keeps the layout minimal per spec while still
  surfacing the lyrics data that `PublicTrack` carries.

Player store integration:
- Imports `usePlayerStore` per spec.
- Creates its own `<audio>` element (ref) and registers it via
  `registerAudio()` on mount (cleanup: `registerAudio(null)` on unmount) — same
  pattern as `BottomPlayer`. This is necessary because the share page has no
  `BottomPlayer`, so the store would otherwise have no audio element to drive.
- Wires the audio element's events (`timeupdate`, `durationchange`,
  `loadedmetadata`, `play`, `pause`, `ended`) to the store's event setters.
- On mount + whenever `track.id` changes, calls `loadSong(song)` to set
  `current` + `audio.src` WITHOUT auto-playing (browsers block
  autoplay-with-sound; the user clicks play).
- `publicTrackToSong(track)` adapts `PublicTrack` → `Song` by filling the
  player-store-only fields (`prompt: ""`, `voice: ""`, `audioFormat: "mp3"`,
  `liked: false`, `bpm/keyScale/timeSignature/seed: null`) with inert defaults.
  None of these are read during playback; they exist only for type compatibility
  with the store's `Song`-typed actions.
- Play button: if `current?.id === track.id`, calls `togglePlay()`; otherwise
  calls `playSong(song)` (which sets src + starts playback).

## Integration TODOs (for the orchestrator)
1. **Create the `/track/[id]` page** (`src/app/track/[id]/page.tsx`) — a Server
   Component that:
   - Fetches `GET /api/track/${id}` server-side (or client-side via `useEffect`).
   - On 404, renders a "Track not found" page.
   - On success, renders `<TrackEmbed track={track} />`.
   - Sets `<title>{track.title} — SpotiBot</title>` via `metadata` export.

2. **Whitelist `/track` in the auth middleware** (`src/middleware.ts`). The
   current matcher protects everything except `signin`/`api/auth`/static. Add
   `track` to the negative lookahead so logged-out visitors can reach the share
   page:
   ```ts
   matcher: [
     "/((?!signin|track|api/auth|api/track|_next/static|...).*)",
   ],
   ```
   Note: `/api/track/*` also needs to be public (it already is — the route
   handlers don't call `getCurrentUserId`), but the middleware matcher applies
   to API routes too, so `api/track` must be in the exception list OR the
   route handlers need to be in a segment with `export const runtime = "edge"` +
   no middleware. Simplest: add both `track` and `api/track` to the matcher
   exception list.

3. **Wire a Share button into the main app** (e.g., in `song-card.tsx`,
   `song-detail.tsx`, or `bottom-player.tsx`) that opens `<ShareDialog>` with
   the current track's id + title. The dialog is already self-contained — just
   drop it in with controlled `open` state.

## Verification
- `cd /home/z/my-project && bun run lint` → **0 errors** in my 5 files. (2
  pre-existing warnings in `profile-view.tsx` — not my file, not touched.)
- `npx tsc --noEmit` → **0 errors** in my 5 files. (Many pre-existing errors in
  other agents' files — `feed`, `follow`, `profile`, `trending`, `generate`,
  `layout`, `song-card`, `song-detail`, `top-bar` — none touched.)
- Dev log shows `✓ Compiled` with no errors attributed to my files; the only
  compile error in the log is the pre-existing `ThemeToggle` named-export
  mismatch in `top-bar.tsx` (another agent's file).

## Code quality
- TypeScript strict throughout, no `any`.
- All public functions + components have JSDoc explaining intent.
- The `PublicTrack` interface is exported from the route file and imported via
  `import type` in `track-embed.tsx` (type-only import → no server code leaks
  into the client bundle).
- Accent palette: fuchsia/purple/rose + emerald (success) — no indigo/blue.
- Dark theme (`bg-[#050507]`, `bg-[#1a1a22]`, `border-white/10`) matches the
  existing app aesthetic.
- Responsive: `max-w-md` card, `sm:` breakpoints for padding, badges wrap.
- Accessibility: aria-labels on every icon button, `aria-expanded` on the
  lyrics toggle, `aria-controls` linking the toggle to the lyrics panel,
  readonly inputs select-all on focus, keyboard-accessible buttons.
