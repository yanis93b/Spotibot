# Task: 3-A — public-profiles

Agent: public-profiles
Status: COMPLETE
Lint: PASS (`bun run lint` → exit 0, no errors/warnings anywhere in the project)

## Scope

Phase 3 of SpotiBot. Built **public user profiles** — each user gets a public
page `/u/[username]` (route wiring is the orchestrator's job; this agent ships
the API + UI components the route consumes). The profile shows the user's
public identity (avatar, name, @username, bio, member-since date), a grid of
their generated tracks, and a list of their playlists.

## Files created (and ONLY these — no existing files modified)

| File | Purpose |
|------|---------|
| `src/app/api/profile/[username]/route.ts` | PUBLIC `GET` — fetch any user's profile by username. Returns `{ user, songs, playlists }`. Songs are mapped through `toPublicSong` (audio bytes never leak). Playlists are a slim summary (id/name/trackCount/createdAt — no song listings). 404 on unknown username. |
| `src/app/api/profile/me/route.ts` | `GET` (auth required) — current user's full profile (same shape as the public endpoint, used to render the viewer's own profile). `PATCH` (auth required) — update name / bio / username. Zod-validated; username uniqueness enforced via pre-flight check + P2002 catch. |
| `src/components/music/profile-view.tsx` | The profile page component. Self-contained: fetches its own data, shows a glassmorphism header (avatar / name / @username / bio / member-since), a responsive tracks grid with hover-play overlay wired to the shared player store, a playlists list, and an inline "Edit Profile" dialog (only when `isOwnProfile`). |
| `prisma/schema-profile.md` | Documents the `username` + `bio` field additions to `User` (orchestrator merges + runs `bun run db:push`). |

## Architecture decisions

### Public endpoint shape

```
GET /api/profile/[username]  →  PUBLIC (no auth)

200: {
  user: {
    id, name, username, bio, image, createdAt  // createdAt is ISO string
  },
  songs: Song[],                                // via toPublicSong — no audio bytes
  playlists: Array<{                            // slim summary per spec
    id, name, trackCount, createdAt
  }>
}
404: { error: "Profile not found" }
500: { error: "Failed to load profile." }
```

- **Username lookup is case-insensitive** — the path param is lowercased
  before `db.user.findUnique({ where: { username } })`. Since the PATCH
  validator enforces lowercase-only usernames, the DB only ever stores
  lowercase values, so the lowercase lookup hits the unique index.
- **Songs cap: 50, playlists cap: 50** — keeps the response payload sane for
  prolific users. Newest-first ordering.
- **Playlists only include `id, name, trackCount, createdAt`** — per spec,
  no song listings, no duration. The `trackCount` is computed via
  `include: { items: { select: { id: true } } }` (cheap — pulls only the
  join row ids, not the nested song payloads).

### Auth-required `/api/profile/me` shape

```
GET /api/profile/me   →  401 if not signed in
                        200 — same shape as the public endpoint
PATCH /api/profile/me →  401 if not signed in
                        400 — validation error / no fields / username taken
                        200 — { user: PublicProfileUser }  (the updated identity block)
```

- **GET returns the full profile** (not just the identity block) so the
  parent route can render the same `<ProfileView/>` for the viewer's own
  profile AND for other users' profiles by hitting different endpoints.
  This keeps the component logic unified.
- **PATCH returns only the updated identity block**, not the full profile.
  The component optimistically patches its local state with the new identity;
  the parent (which owns the URL) decides whether to redirect (e.g. on a
  username change) via the `onProfileUpdated` callback.

### Username validation

- 3–20 chars, lowercase letters + digits + single hyphens only
- Must start AND end with an alphanumeric character (no leading/trailing
  hyphens)
- No consecutive hyphens
- Implemented via the regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` (one or more
  alphanumeric segments separated by single hyphens) + `.min(3).max(20)`.
  The regex implicitly enforces all the structural rules; zod enforces the
  length.
- **Defensive lowercase** is applied again at the PATCH handler
  (`data.username = parsed.data.username.toLowerCase()`) — guards against
  any future regex relaxation.

### Username uniqueness

Two-layer defense:
1. **Pre-flight `findUnique({ where: { username } })`** — if a *different*
   user already has the requested username, return 400 with a specific
   "Username is already taken." message (no write attempt).
2. **Catch Prisma `P2002`** on the `update` — if a race between the
   pre-flight check and the write produces a unique-constraint violation,
   the catch maps it to the same 400 message.

### Edit Profile flow (in `profile-view.tsx`)

- The dialog is **embedded inside the component** (parent only passes
  `isOwnProfile`). State is local: `name`, `bio`, `username`, `saving`,
  `formError`.
- **Auto-lowercases + filters invalid chars** as the user types in the
  username field — immediate UX feedback, mirrors the server-side validator.
- **Char counter** for the bio (max 200) — turns rose when over budget.
- **Only sends changed fields** in the PATCH body — comparing against the
  pre-edit `currentUser` prop. Avoids the "No updatable fields provided"
  400 when the user opens the dialog and clicks Save without changing
  anything (in which case we just close the dialog with no network call).
- **On success**: optimistically patches the local `profile` state with the
  new identity, fires a toast, closes the dialog, and calls the optional
  `onProfileUpdated(updated)` callback. The parent can redirect on a
  username change (the URL becomes stale), in which case the component
  remounts with the new `username` prop and refetches.

### ProfileView UX details

- **Avatar**: deterministic gradient (hue from `hueFromString(user.id)`,
  same hashing scheme as `cover-image.tsx`) when no `image` is set; the
  user's initials (from `name` or `username`) are rendered on top. When an
  `image` URL is set (e.g. from GitHub OAuth), it's rendered as an `<img>`
  with `referrerPolicy="no-referrer"` (some OAuth providers block
  referrer-based hotlinking).
- **Hover-play on song cards** is wired directly to the shared
  `usePlayerStore` — clicking play loads the song into the bottom player
  (the single-source-of-truth audio element owned by `<BottomPlayer/>`),
  exactly like the existing `SongCard`. The "currently playing" card
  highlights in fuchsia.
- **Empty states**: distinct copy for own-profile vs. other-user-profile
  ("Generate your first track…" vs. "This user hasn't generated any tracks
  yet."). Both have an icon + title + subtitle inside a dashed-border tile.
- **Loading skeleton**: full-page skeleton that mirrors the loaded layout
  (header card + tracks grid with 5 placeholder cards) so the layout
  doesn't jump on load.
- **404 state**: friendly "Profile not found" with the typed-in @username
  in the message and a "Check the spelling and try again." hint.
- **Accessibility**: every icon-only button has an `aria-label`; form
  fields have associated `<Label>`s; the error message in the dialog is
  `role="alert"`; section headings use semantic `<section aria-label>`;
  the loading skeleton sets `aria-busy="true"` on its wrapper.
- **Responsive**: header stacks avatar / identity / edit-button vertically
  on mobile; tracks grid is `grid-cols-2 sm:grid-cols-3 md:grid-cols-4
  xl:grid-cols-5`. Touch targets are ≥36px (size-9 buttons).

### Why duplicate the response types instead of cross-importing?

The public-profile response types (`PublicProfileUser`,
`PublicPlaylistSummary`, `PublicProfileResponse`) are defined locally in
three places:
- `src/app/api/profile/[username]/route.ts` (canonical export)
- `src/app/api/profile/me/route.ts` (local copy)
- `src/components/music/profile-view.tsx` (local copy)

Type-only cross-route imports *should* be erased at compile time, but
Next.js's route-file bundler can warn or behave unexpectedly when one
route file imports from another. To stay within the project's existing
pattern (shared types live in `src/lib/types.ts` — which this agent can't
modify), the types are duplicated locally. The shapes are frozen by the
spec, so drift is not a concern. The duplication is clearly documented
in each file.

## Integration TODOs for the orchestrator

1. **Merge `prisma/schema-profile.md` into `prisma/schema.prisma`** — add
   the `username String? @unique` and `bio String?` fields to `User`.
2. **Run `bun run db:push`** — applies the new columns to SQLite and
   regenerates the Prisma client (so `db.user.findUnique({ where: { username } })`
   and `user.username` / `user.bio` type-check).
3. **Create the `/u/[username]` route** — a Next.js page at
   `src/app/u/[username]/page.tsx` that:
   - Reads `params.username`
   - Determines `isOwnProfile` server-side by comparing `getCurrentUserId()`
     against the profile owner (or by comparing the path username to the
     current user's stored username)
   - Renders `<ProfileView username={username} isOwnProfile={...} />`
4. **Optional**: add a "View my profile" / "View profile" link in the
   sidebar or top-bar that navigates to `/u/[currentUsername]` (only when
   the current user has a username set; otherwise the link could open the
   edit dialog to prompt them to set one).

## Lint

`bun run lint` → exit 0, no errors or warnings in any file (not just my
owned files — the whole project is currently clean).

## Notes

- The pre-existing dev.log errors about `ThemeToggle` in `top-bar.tsx` are
  from Task 2-C's integration (the orchestrator hasn't yet wired
  `<ThemeToggle/>` into the top bar correctly — it imports a named export
  but the file only has a default export). Not caused by my changes; out
  of my ownership.
- The Prisma schema additions are required for the new API routes to
  type-check at runtime — the lint (ESLint) doesn't deep-check Prisma
  client field access, so lint passes today, but the actual queries
  (`db.user.findUnique({ where: { username } })`, `user.username`,
  `user.bio`) will fail at runtime until `bun run db:push` is run with
  the merged schema. This matches the pattern established by Task 2-A
  (queue-history) and Task 2-D (playlist-dnd).
