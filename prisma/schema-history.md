# Prisma Schema Addendum — ListeningHistory

> **Phase 2, Task 2-A** (queue-history agent)
> This file documents the `ListeningHistory` model that must be merged into
> `prisma/schema.prisma` by the orchestrator. It intentionally does **not**
> modify the canonical schema file so other agents can run in parallel.

## New model

```prisma
/// A single "user played this song" event. Used to build the listening
/// history feed (newest first). Cascade-deleted with both the user and the
/// song so history never dangles after either side is removed.
model ListeningHistory {
  id        String   @id @default(cuid())
  userId    String
  songId    String
  playedAt  DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  song      Song     @relation(fields: [songId], references: [id], onDelete: Cascade)

  @@index([userId, playedAt])
}
```

## Edits to existing models

Add the back-relation field to both `User` and `Song`:

```prisma
model User {
  // …existing fields…
  history   ListeningHistory[]
}

model Song {
  // …existing fields…
  history   ListeningHistory[]
}
```

## Notes for the orchestrator

- The compound index `@@index([userId, playedAt])` makes the
  `GET /api/history` query (filter by `userId`, order by `playedAt` desc) an
  index-only scan.
- `onDelete: Cascade` on both relations means deleting a user purges their
  history and deleting a song purges any history rows referencing it. This
  matches the existing pattern used by `Playlist` / `PlaylistSong`.
- No `@@unique` constraint is added — repeated plays of the same song are
  intentionally allowed (every play creates a new row), which is what
  drives a Spotify-style "recently played" feed.
- After merging, run `bun run db:push` to apply the new model to the SQLite
  database and regenerate the Prisma Client.
