# Prisma Schema Addendum — Public User Profiles

> **Phase 3, Task 3-A** (public-profiles agent)
> This file documents the changes to the `User` model needed for public user
> profiles. It intentionally does **not** modify `prisma/schema.prisma` so
> other agents can run in parallel. The orchestrator must merge these fields
> into the canonical schema and run `bun run db:push` to apply them.

## Summary

Two new optional fields on `User`:

| Field      | Type     | Constraints                                | Purpose                                                       |
|------------|----------|--------------------------------------------|---------------------------------------------------------------|
| `username` | `String?`| `@unique`, lowercase, alphanumeric + hyphens, 3–20 chars | Public handle for the profile URL `/u/[username]`.           |
| `bio`      | `String?`| max 200 chars                              | Free-form profile bio shown on the public profile page.       |

## Edits to `model User`

```prisma
model User {
  id        String     @id @default(cuid())
  email     String     @unique
  name      String?
  password  String? // null for OAuth-only users
  image     String?

  // ─── NEW: public profile fields ───────────────────────────────────────────
  username  String?    @unique  // lowercase, alphanumeric + hyphens, 3–20 chars
  bio       String?             // free-form bio, max 200 chars
  // ──────────────────────────────────────────────────────────────────────────

  createdAt DateTime   @default(now())
  songs     Song[]
  playlists Playlist[]
  history   ListeningHistory[]
}
```

## Why these fields

### `username String? @unique`
- **Optional** (`String?`) so existing users created before this field existed
  are not forced to pick a username immediately. They can set one later via
  `PATCH /api/profile/me`.
- **`@unique`** so we can look up a user by handle in O(log n) via
  `db.user.findUnique({ where: { username } })`. The Prisma client generates
  a `UserWhereUniqueInput` that accepts `username` as a key once the schema is
  pushed. This is what `GET /api/profile/[username]` relies on.
- **Validation rules** (enforced at the API layer in
  `PATCH /api/profile/me`, not at the DB layer):
  - 3–20 characters
  - Lowercase letters (`a–z`), digits (`0–9`), and hyphens (`-`) only
  - Must start and end with an alphanumeric character (no leading/trailing
    hyphens)
  - No consecutive hyphens (`--`)

### `bio String?`
- **Optional** free-form text, capped at 200 characters (enforced at the API
  layer). Stored as a plain `String?` — no need for a `@db.Text` annotation on
  SQLite (SQLite has no separate TEXT vs VARCHAR distinction).

## Notes for the orchestrator

- After merging, run `bun run db:push` to apply the new columns to SQLite and
  regenerate the Prisma Client. The client must be regenerated before the new
  API routes (`/api/profile/[username]`, `/api/profile/me`) will type-check —
  they reference `user.username`, `user.bio`, and
  `db.user.findUnique({ where: { username } })`.
- The `username` unique index is created automatically by Prisma on
  `db:push`. SQLite enforces it at the DB level, so a duplicate-username
  insert will throw Prisma `P2002`. `PATCH /api/profile/me` catches this and
  returns `400 { error: "Username is already taken" }`.
- Existing users will have `username = NULL` and `bio = NULL` after the
  migration. `GET /api/profile/[username]` returns 404 for any handle that
  isn't set — there is no "default" username derived from the email.
- The NextAuth callbacks in `src/lib/auth.ts` already expose `user.id` on the
  session via the JWT callback — no changes to the auth layer are needed.
  Profile pages identify the viewer via `getCurrentUserId()` and compare
  against the profile owner's id.
