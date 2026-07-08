# Schema changes — Follow system (Task 3-D)

This file documents the Prisma schema additions required by the follow system
(users following other users + a following feed of tracks).

The orchestrator is responsible for merging these into `prisma/schema.prisma`
and running `bun run db:push` to materialize the new table + indices.

## New model: `Follow`

A join table representing a directed "follower → following" relationship
between two `User` rows. The compound unique `@@unique([followerId, followingId])`
makes a follow idempotent at the DB layer (a second `create` for the same pair
throws `P2002`, which the API maps to a 400 "already following" response).

```prisma
model Follow {
  id          String   @id @default(cuid())
  followerId  String   // the user who follows
  followingId String   // the user being followed
  createdAt   DateTime @default(now())

  follower  User @relation("follower", fields: [followerId], references: [id], onDelete: Cascade)
  following User @relation("following", fields: [followingId], references: [id], onDelete: Cascade)

  @@unique([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
}
```

### Field semantics

| Field         | Type     | Notes                                                              |
| ------------- | -------- | ------------------------------------------------------------------ |
| `id`          | `String` | CUID primary key.                                                  |
| `followerId`  | `String` | FK → `User.id` — the user who is following.                        |
| `followingId` | `String` | FK → `User.id` — the user being followed.                          |
| `createdAt`   | DateTime | Defaults to `now()` — used for ordering the "following" list.      |

### Indices

- `@@unique([followerId, followingId])` — idempotent follow enforcement; also
  makes the "is X following Y?" lookup a single indexed point read.
- `@@index([followerId])` — speeds up "who does X follow?" listings.
- `@@index([followingId])` — speeds up "who follows Y?" listings (used by the
  feed route to query songs from followed users via `ownerId: { in: [...] }`).

### Cascade rules

Both relations use `onDelete: Cascade`. Deleting a user removes every Follow
row in which they appear (either as the follower or as the followed user) —
matches the pattern used by `ListeningHistory` and `PlaylistSong`.

## `User` additions (back-relations)

Add two back-relations on `User` so Prisma can navigate both sides of the
edge. `followers` = users who follow me; `following` = users I follow. The
relation names `"follower"` / `"following"` match those on the `Follow` model
above.

```prisma
model User {
  // … existing fields …

  followers  Follow[] @relation("following") // people who follow me
  following  Follow[] @relation("follower")  // people I follow
}
```

## Notes for the orchestrator

1. The existing `User` model has **no `username` field** — only `email`,
   `name`, `image`. The follow API returns `{ id, name, username, image }`
   per the spec; in this round `username` is `null` (we never persist one).
   If a real `username` column is added later, the `GET /api/follow` handler
   should be updated to read it from the row instead of returning `null`.

2. No changes to the public `Song` shape are required — the feed route
   reuses `toPublicSong()` from `src/lib/song-mapper.ts` and attaches the
   owner's display name in the response envelope (not on the `Song` itself),
   so the shared type contract stays untouched.

3. **Optional `isPublic` field on `Song`** — the spec for the feed route
   calls for `where: { ownerId: { in: followedIds }, isPublic: true }`.
   The existing `Song` model has no `isPublic` column, so for this round
   `GET /api/feed` filters by `ownerId IN followedIds` only (every owned
   song is treated as public — matches the existing `/api/browse` and
   `/api/songs` behavior). When an `isPublic Boolean @default(true)`
   field is added to the `Song` schema, update `src/app/api/feed/route.ts`
   to also filter by `isPublic: true`. Suggested addition to the `Song`
   model:
   ```prisma
   isPublic Boolean @default(true)
   @@index([isPublic, ownerId, createdAt])
   ```

4. After merging, run `bun run db:push`. No data migration is needed — the
   `Follow` table starts empty and the new indices are pure additions.
