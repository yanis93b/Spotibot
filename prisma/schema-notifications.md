# Schema changes — In-app notifications (Task 4-D)

This file documents the Prisma schema additions required by the in-app
notification system: a bell icon in the top bar with a red unread-count badge
and a dropdown panel showing recent activity (new followers, track likes,
generation completions, system messages).

The orchestrator is responsible for merging these into `prisma/schema.prisma`
and running `bun run db:push` to materialize the new table + indices. After the
push, the Prisma client must be regenerated (the post-push hook does this
automatically) so `db.notification.*` type-checks at runtime.

## New model: `Notification`

A single in-app notification addressed to exactly one recipient (`userId`).
Each row carries a coarse `type` (used by the bell UI to pick an icon + accent
color), a short `title`, an optional longer `body`, and a `read` flag.

```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String   // recipient
  type      String   // "follow" | "like" | "generation" | "system"
  title     String
  body      String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, read, createdAt])
}
```

### Field semantics

| Field       | Type     | Notes                                                                                     |
| ----------- | -------- | ----------------------------------------------------------------------------------------- |
| `id`        | `String` | CUID primary key.                                                                         |
| `userId`    | `String` | FK → `User.id` — the recipient of the notification.                                       |
| `type`      | `String` | Coarse category. One of `"follow"`, `"like"`, `"generation"`, `"system"`. Drives the UI icon + accent. |
| `title`     | `String` | One-line headline shown in the bell dropdown (e.g. "Jane started following you").        |
| `body`      | `String?` | Optional longer description (e.g. the title of the liked track). `null` when the title alone is enough. |
| `read`      | `Boolean` | Defaults to `false`. Set to `true` by `POST /api/notifications { readAll: true }`.      |
| `createdAt` | DateTime | Defaults to `now()`. Used for ordering (newest first) and the relative-time label.       |

### Type strings

The `type` column is a free-form `String` rather than a Prisma `enum` because
SQLite has no native enum support. The set of currently-defined values is:

- `"follow"` — someone started following the recipient.
- `"like"` — someone liked the recipient's track.
- `"generation"` — a track generation finished (success or failure).
- `"system"` — a platform-level message (welcome, maintenance, etc.).

The bell component maps unknown types to a default icon + neutral accent, so
adding a new type later is non-breaking (the dropdown will still render it,
just without a custom icon).

### Index

- `@@index([userId, read, createdAt])` — covers the two hottest access paths
  with a single composite index:
  1. The bell's `GET /api/notifications` reads the recipient's 30 newest rows
     ordered by `createdAt DESC` — Prisma can seek into the index by `userId`
     and stream the tail.
  2. The unread-count badge reads `where: { userId, read: false }` — also a
     prefix of the same index, so it's a single indexed range scan.

### Cascade rules

`onDelete: Cascade` on the `user` relation means deleting a `User` row removes
every `Notification` addressed to them. This matches the pattern used by
`ListeningHistory`, `Follow`, `PlaylistSong`, and `Playlist`.

## `User` additions (back-relation)

Add a single back-relation on `User` so Prisma can navigate from a user to
their notifications:

```prisma
model User {
  // … existing fields …

  notifications Notification[]
}
```

## API surface (owned by this task, no overlap)

Two handlers live in `src/app/api/notifications/route.ts`:

- `GET /api/notifications` — auth-required. Returns the current user's
  notifications, newest first, capped at 30. Response shape:
  `{ notifications: NotificationItem[] }` where
  `NotificationItem = { id, type, title, body, read, createdAt }`
  (`createdAt` is an ISO 8601 string).
- `POST /api/notifications` — auth-required. Body `{ readAll: true }` marks
  every unread notification for the current user as read. Returns
  `{ success: true, updated: number }`. Idempotent (returns `updated: 0` when
  there's nothing to mark).

## Who writes notifications?

The notification row is written by **other** Phase 4 agents when an event
happens:

- A `follow` event → written by the follow API (`POST /api/follow`) when a
  new `Follow` row is created (recipient = the followed user).
- A `like` event → written by the like endpoint when a `Song.liked` flips from
  `false` to `true` (recipient = the song's owner).
- A `generation` event → written by `POST /api/generate` after the audio
  synthesis succeeds (or fails) for the requesting user.
- A `system` event → written by the platform (welcome-on-signup, etc.).

The `db.notification.create({ data: { userId, type, title, body? } })` call is
a one-liner; no extra schema or API surface is needed for writers. The
orchestrator should ensure each writer wraps the `create` in a `try/catch`
so a notification failure never breaks the primary operation (notifications
are best-effort UX, not transactional).

## Notes for the orchestrator

1. After merging, run `bun run db:push`. No data migration is needed — the
   `Notification` table starts empty and the new index is a pure addition.

2. ESLint does not deep-check Prisma client field access, so `bun run lint`
   passes today even though `db.notification.*` won't type-check until the
   Prisma client is regenerated. This matches the pattern established by
   Tasks 2-A, 2-D, 3-A, 3-D — the route file will work as soon as the
   orchestrator runs `db:push` (which regenerates the client).

3. The bell component (`src/components/music/notification-bell.tsx`) is fully
   self-contained: it fetches `/api/notifications`, polls every 60s while
   open, marks all as read on button click, and renders an empty state when
   there are zero notifications. To mount it in the top bar, the orchestrator
   should add `<NotificationBell />` next to `<ThemeToggle />` in
   `src/components/music/top-bar.tsx` — no props are required (the optional
   `className` prop is for positioning only).
