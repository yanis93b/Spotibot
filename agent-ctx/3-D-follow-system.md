# Task 3-D — Follow system (Agent 3-D)

## Scope
Phase 3 follow system for SpotiBot: users can follow other users and see a
feed of tracks from creators they follow.

## Files owned (created, no overlap)
- `prisma/schema-follow.md` — documents the `Follow` join model + `User`
  back-relations + notes on `username` and `isPublic` gaps for the orchestrator.
- `src/app/api/follow/route.ts` — `POST /api/follow` (follow) +
  `GET /api/follow` (list who I follow).
- `src/app/api/follow/[userId]/route.ts` — `DELETE /api/follow/[userId]`
  (unfollow) + `GET /api/follow/[userId]` (check if I follow).
- `src/app/api/feed/route.ts` — `GET /api/feed?page=1&limit=20` (paginated
  tracks from followed users).
- `src/components/music/follow-button.tsx` — optimistic Follow/Following/
  Unfollow button.
- `src/components/music/feed-view.tsx` — the following feed UI.

## API contract

### `POST /api/follow` — follow a user
- Body: `{ followingId: string }`
- 201 `{ id, followerId, followingId, createdAt }` — newly created follow
- 200 same shape — idempotent (already following)
- 400 `{ error }` — self-follow / already-following (P2002 fallback) / bad body
- 401 `{ error: "Unauthorized" }`
- 404 `{ error: "User not found." }` — target doesn't exist (pre-flight check)
- 500 `{ error }`

### `GET /api/follow` — list who I follow
- 200 `{ following: Array<{ id, name, username, image }> }` — newest follows
  first. `username` is `null` in this round (User has no such column).

### `DELETE /api/follow/[userId]` — unfollow
- 200 `{ success: true }` — idempotent (uses `deleteMany` so a no-row delete
  doesn't throw P2025)
- 401 / 500

### `GET /api/follow/[userId]` — check follow status
- 200 `{ following: boolean }` — single indexed point-read on the
  `followerId_followingId` compound unique. Doesn't reveal whether the
  target user exists.

### `GET /api/feed?page=1&limit=20` — following feed
- 200 `{ songs: FeedSong[], total, page, limit, hasMore }` — `FeedSong` is
  the public `Song` shape plus `ownerId`, `ownerName`, `ownerImage`. Newest
  first, paginated.
- 401 / 500
- Empty short-circuit: when the caller follows 0 users, returns
  `{ songs: [], total: 0, page, limit, hasMore: false }` without firing the
  song query.

## Schema changes (documented in `schema-follow.md`)
```prisma
model Follow {
  id          String   @id @default(cuid())
  followerId  String
  followingId String
  createdAt   DateTime @default(now())
  follower  User @relation("follower",  fields: [followerId],  references: [id], onDelete: Cascade)
  following User @relation("following", fields: [followingId], references: [id], onDelete: Cascade)
  @@unique([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
}

// On User:
followers  Follow[] @relation("following")
following  Follow[] @relation("follower")
```

### Notable gaps surfaced (orchestrator action items)
1. **No `username` column on User.** `GET /api/follow` returns
   `username: null` for now. If a real `username` is added later, the handler
   should read it from the row.
2. **No `isPublic` column on Song.** The spec calls for
   `where: { ownerId: { in: followedIds }, isPublic: true }`, but the current
   Song model has no `isPublic` field. The feed route filters by
   `ownerId IN followedIds` only — every owned song is treated as public
   (matches the existing `/api/browse` and `/api/songs` scoping). When an
   `isPublic Boolean @default(true)` column is added, update the feed route's
   `where` clause. Suggested schema addition is in `schema-follow.md`.

## UI design

### `follow-button.tsx`
- States:
  - **Not following** → "Follow" (fuchsia→rose gradient pill, primary CTA)
  - **Following** → "Following" (subtle dark pill, `bg-white/[0.06]`)
  - **Following + hover/focus** → "Unfollow" (rose-tinted pill,
    `bg-rose-500/15 text-rose-200`)
- Optimistic: the label flips immediately on click; the API call fires in
  the background. On error we roll back and surface a toast via the existing
  `useToast` hook (routes to the mounted shadcn `<Toaster/>`).
- Idempotent: a follow click when already-following is a no-op (the API also
  returns 200 for the already-following case).
- Hides itself when:
  - `status === "loading"` (avoid a flash of "Follow" for a user we may
    already be following)
  - `meId` is null (anonymous — no point prompting follow without auth)
  - `meId === userId` (can't follow yourself)
- Reads the current user's id via `useSession` (the id is embedded in the
  JWT via the `jwt`/`session` callbacks in `src/lib/auth.ts`).
- Accessibility: `aria-pressed` reflects the optimistic follow state;
  `aria-label` describes the current + hovered action; focus-visible ring
  (fuchsia) on every interactive state.

### `feed-view.tsx`
- Header with `Users2` icon, "Following Feed" title, track count.
- Initial-load skeleton (6 rows matching the row layout).
- Error state: rose-tinted alert with the error message.
- Empty state: per spec —
  "You're not following anyone yet. Browse the discover feed to find creators."
  Plus a "Try the Browse tab" hint chip (Compass icon) for the natural
  next-action.
- Each row: `[index/play] [cover] [title + "by [owner name]"] [genre · mood] [explicit play button]`
  - The current track (matched via `usePlayerStore`) is highlighted and
    shows Pause; clicking it toggles `store.togglePlay()`.
  - The explicit play button is opacity-0 until row hover (so the row stays
    calm when nothing is playing).
  - `ownerName` falls back to "Unknown creator" when missing.
  - Cover via the shared `<CoverImage>` component (renders AI PNG or
    deterministic gradient fallback).
- Pagination: a "Load more tracks" button appends the next page (no infinite
  scroll to keep things simple + a11y-friendly).

## Patterns followed (consistency with existing code)
- `getCurrentUserId()` auth gate at the top of every protected handler.
- `force-dynamic` on every route (follow state changes constantly).
- `NextRequest` + `params: Promise<{ userId: string }>` (Next 16 async-params).
- `Prisma.PrismaClientKnownRequestError` handling for `P2002` / `P2003` /
  `P2025`.
- `toPublicSong()` from `src/lib/song-mapper.ts` to map DB rows to the
  public `Song` shape (no audio bytes ever leak).
- Fuchsia/rose accent palette only (no indigo/blue).
- Tailwind theme tokens (`bg-background`, `text-foreground`,
  `text-muted-foreground`) — re-skins automatically in light/dark mode.
- shadcn `useToast` for error notifications (matches Agent 1's choice).
- Optimistic UI pattern from `use-songs.ts` (flip → API → rollback on error).

## Lint status
- `bun run lint` — all 6 owned files clean (0 errors, 0 warnings).
- The 2 remaining project-wide errors are in `share-dialog.tsx` (not my
  file; `react-hooks/set-state-in-effect`).

## TypeScript status
- `npx tsc --noEmit` reports 6 errors, ALL of which are
  `Property 'follow' does not exist on type 'PrismaClient'` — i.e. the
  Follow model isn't merged into `prisma/schema.prisma` yet. This is the
  same documented pattern as Task 2-A (queue-history): the schema addendum
  lives in `prisma/schema-follow.md`, and the orchestrator merges + runs
  `bun run db:push` to regenerate the Prisma client. ESLint passes because
  it doesn't deep-type-check Prisma client field access; `db.follow` resolves
  once `db:push` runs.

## Integration TODOs (for the orchestrator)
1. Merge the `Follow` model + `User` back-relations from
   `prisma/schema-follow.md` into `prisma/schema.prisma`.
2. Run `bun run db:push` to create the table + regenerate the Prisma client
   (the 6 TS errors in my route files will clear).
3. Mount `<FollowButton userId={…} initialFollowing={…} />` wherever a
   creator's profile / card is rendered (e.g. next to the owner name in
   `FeedView` rows, on a future user-profile view, or in the sidebar's
   "Following" list).
4. Mount `<FeedView onPlay={(song) => usePlayerStore.getState().playSong(song)} />`
   as a new sidebar view (e.g. "Following"). The `onPlay` callback should
   hand the song to the shared player store.
5. (Optional) Add a `username String? @unique` column to `User` and update
   `GET /api/follow` to read it.
6. (Optional) Add an `isPublic Boolean @default(true)` column to `Song` and
   update `GET /api/feed` to filter by `isPublic: true`.
