# Task: auth-api-scoping — Scope all API routes by authenticated user (ownerId)

Agent: api-scoping
Status: COMPLETE
Lint: PASS (clean)

## Scope
Every API route (except the public `health/ace` probe) now:
1. Calls `getCurrentUserId()` from `@/lib/session` at the top of the handler.
2. Returns `401 { error: "Unauthorized" }` when no user is signed in.
3. Scopes all Prisma queries by `ownerId: userId` (findMany filters, findUnique/update/delete compound `where`, and `ownerId` set on create).

## Files updated
| File | Handlers | Change |
|------|----------|--------|
| `src/app/api/generate/route.ts` | POST | auth gate (before rate limit); `ownerId: userId` on `db.song.create` |
| `src/app/api/songs/route.ts` | GET | auth gate; `where: { ownerId: userId }` on findMany |
| `src/app/api/songs/[id]/route.ts` | DELETE, PATCH | auth gate; `where: { id, ownerId: userId }` on delete/update (404 on P2025) |
| `src/app/api/playlists/route.ts` | GET, POST | auth gate; GET filter by ownerId, POST sets ownerId |
| `src/app/api/playlists/[id]/route.ts` | GET, PATCH, DELETE | auth gate; `getPlaylistWithSongs(id, ownerId)`; update/delete scoped `where: { id, ownerId: userId }` |
| `src/app/api/playlists/[id]/tracks/route.ts` | POST, DELETE | auth gate; POST verifies playlist + song belong to caller; DELETE verifies playlist ownership before mutating |
| `src/app/api/audio/[id]/route.ts` | GET | auth gate; `findUnique({ where: { id, ownerId: userId } })` (404 if not owned) |
| `src/app/api/cover/[id]/route.ts` | GET | auth gate; `findUnique({ where: { id, ownerId: userId } })` (404 if not owned) |
| `src/app/api/health/ace/route.ts` | GET | **UNCHANGED** — intentionally public health check |

## Key decisions
- Auth gate is placed at the very top of each handler (before rate limit / body parse) so unauthenticated callers never touch expensive work or fill rate-limit buckets.
- For `findUnique` on owner-scoped resources, we use the compound `where: { id, ownerId: userId }` so a non-owner gets a 404 (matching the existing "not found" semantics) — no existence leakage.
- In `playlists/[id]/tracks` POST, both the playlist AND the song are looked up with `ownerId: userId`, preventing a user from adding another user's song to their own playlist (defense in depth, consistent with the ownerId-scoping intent).
- In `playlists/[id]/tracks` DELETE, an explicit playlist ownership pre-check returns `404 { error: "Playlist not found" }` for non-owned playlists before the join-row delete runs.
- No non-API files were touched. No existing logic (zod validation, rate limiter, position re-packing, P2002 duplicate handling, error mapping) was changed.

## Verification
- `cd /home/z/my-project && bun run lint` → PASS (no errors, no warnings in touched files).
- Prisma schema confirmed `ownerId String` exists on both `Song` and `Playlist` models (with `@@index([ownerId])`), so the compound `where: { id, ownerId }` is type-safe.

## For downstream agents
- All API responses now require a NextAuth session. Any client fetch hitting these endpoints without a session will receive `401 { error: "Unauthorized" }` — frontend hooks should handle this (redirect to /login or surface a sign-in prompt).
- `toPublicSong` / `toPublicPlaylist` shapes are unchanged, so no frontend mapping changes are needed.
- The `health/ace` endpoint remains public and is suitable for unauthenticated pre-flight checks.
