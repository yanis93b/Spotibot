# Prisma Schema Addendum — Song.isPublic

> **Phase 3, Task 3-C** (discover-trending agent)
> This file documents the new `isPublic` field on `Song` that must be merged
> into `prisma/schema.prisma` by the orchestrator. It intentionally does **not**
> modify the canonical schema file so other agents can run in parallel.

## Why

Phase 3 adds a public **Discover feed** (`GET /api/discover`) and a **Trending**
carousel (`GET /api/trending`) — a Spotify-style "browse what the world is
making" surface that shows tracks from **all** users, not just the signed-in
one. To do that without leaking private tracks, the `Song` model needs a flag
that the owner explicitly opts a track into. `isPublic` is that flag.

## Edit to the existing `Song` model

Add the `isPublic` boolean field, defaulting to `false` (existing rows and any
newly-generated song stay private unless explicitly shared):

```prisma
model Song {
  // …existing fields…
  isPublic Boolean @default(false)  // when true, appears in the discover feed
  // …existing relations…
}
```

## Suggested index

Both new endpoints filter `where: { isPublic: true }` and order by
`createdAt` desc. A compound index makes the discover pagination query and
the trending query index-only scans:

```prisma
model Song {
  // …
  @@index([isPublic, createdAt])
}
```

(The existing `@@index([createdAt])` and `@@index([liked])` are still useful
for owner-scoped library queries; the new index specifically targets the
public feed.)

## Migration

After merging, run:

```bash
bun run db:push
```

SQLite will add the new column with the default value (`false`) for existing
rows — no data migration needed. The Prisma Client is regenerated automatically
by `db:push`, after which the new `isPublic` field becomes type-safe in
`db.song.findMany({ where: { isPublic: true } })` (the route files in this
task are written against the future schema; ESLint does not catch the missing
field, but `tsc --noEmit` will until `db:push` runs).

## Orchestrator follow-ups (required for the feed to be useful end-to-end)

The Discover + Trending endpoints are PUBLIC (no auth), but several existing
owner-scoped routes need to be relaxed so a viewer can actually **play** a
foreign public track. These are out of this task's file ownership but should
be done by the orchestrator alongside the schema merge:

1. **`/api/audio/[id]`** — currently scoped `where: { id, ownerId: userId }`
   (404 for foreign songs). Relax to allow streaming when the song is public:
   `where: { id, OR: [{ ownerId: userId }, { isPublic: true }] }`. Without
   this, clicking a foreign public track in the Discover feed will hit a 404
   on the audio fetch and never play.
2. **`/api/cover/[id]`** — same relaxation for cover art so the carousel/grid
   thumbnails render.
3. **`/api/songs/[id]` (PATCH)** — extend the body schema to accept
   `{ isPublic?: boolean }` so the owner can toggle a track's visibility.
   The Discover feed will be empty until at least one track is flipped to
   `isPublic: true` (or `/api/generate` defaults `isPublic: true` for some
   subset of new tracks — that's a product decision for the orchestrator).

## Privacy notes

- The public `Song` shape returned by `toPublicSong` (see `src/lib/song-mapper.ts`)
  already **omits `ownerId`** — no user information is exposed by the discover
  or trending endpoints.
- The `liked` field on the public `Song` reflects the **owner's** like state
  (it's a column on `Song`, not a per-viewer join). In the discover context
  this is a minor semantic quirk; the viewer cannot like/unlike foreign
  tracks from the discover view (the like button is intentionally not shown
  in `discover-view.tsx`), so the field's value is harmless. A future
  per-user Likes table would replace this column entirely.
