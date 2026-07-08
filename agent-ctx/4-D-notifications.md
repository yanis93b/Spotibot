# Task 4-D — In-app notification system

**Agent:** 4-D (notifications)
**Phase:** 4 of SpotiBot
**Task ID:** 4-D

## Goal

Create an in-app notification system: bell icon in the top bar with a red
unread-count badge + glassmorphism dropdown showing recent activity (new
followers, track likes, generation completions, system messages). Plus the
auth-scoped GET/POST API and the Prisma schema documentation.

## Files owned (created, no overlap)

1. `prisma/schema-notifications.md` — documents the new `Notification` model +
   the `notifications Notification[]` back-relation on `User`, the
   `@@index([userId, read, createdAt])` rationale, type-string semantics,
   cascade rules, the API surface, who-writes-notifications notes, and the
   orchestrator's merge + `bun run db:push` TODO.
2. `src/app/api/notifications/route.ts` — `GET` list (newest first, max 30,
   scoped by `userId`) + `POST { readAll: true }` mark all as read (idempotent
   `updateMany`). Auth required via `getCurrentUserId`; zod-validated POST
   body. Exports the canonical `NotificationItem` / `NotificationType` types.
3. `src/components/music/notification-bell.tsx` — `'use client'` bell icon
   button with red unread badge + dark glassmorphism dropdown. Per-type icons
   (UserPlus/Heart/Sparkles/Info/Bell), per-type accent gradients
   (fuchsia/rose/purple/emerald/neutral), relative timestamps via `date-fns`
   `formatDistanceToNow`, "Mark all as read" footer button, "No
   notifications" empty state. Polls every 60s while open. Closes on outside
   click + Escape. Self-contained — no required props.

## Architecture decisions

- **Schema as documentation only.** I did NOT touch `prisma/schema.prisma` —
  the new `Notification` model + the `notifications Notification[]` back-relation
  on `User` are documented in `prisma/schema-notifications.md` for the
  orchestrator to merge + `bun run db:push`. This is the same convention used
  by Tasks 2-A, 2-D, 3-A, 3-D (each new model is its own `schema-*.md` addendum).
  ESLint doesn't deep-check Prisma client field access, so `bun run lint` passes
  today; the route file's `db.notification.*` calls will type-check + work as
  soon as the orchestrator merges + pushes (which regenerates the Prisma client).
- **Free-form `type` column.** The spec defines four type values (`follow`,
  `like`, `generation`, `system`). I kept the column as `String` (not a Prisma
  `enum` — SQLite has no enum support) and the bell component maps unknown
  types to a default icon + neutral accent, so adding a new type later is
  non-breaking.
- **Composite index `@@index([userId, read, createdAt])`.** Single index covers
  both hot paths: the bell's `GET` (`WHERE userId ORDER BY createdAt DESC LIMIT
  30`) and the unread-count badge (`WHERE userId AND read = false`). Avoids two
  separate indices.
- **`updateMany` for mark-all-read.** Idempotent — returns `{ updated: 0 }`
  when there's nothing to mark (instead of throwing P2025 like a per-row
  `update` would). The route is narrowly scoped: the zod schema is
  `z.object({ readAll: z.literal(true) })`, so any other body is a 400.
- **`NotificationItem` type defined locally in the bell component** (mirroring
  the API route's exported type) rather than imported from the route file.
  This avoids pulling server-only code into the client bundle — same pattern
  the share-embed agent (3-B) used for `PublicTrack`.
- **Polling only while open.** Initial fetch on mount populates the badge;
  `setInterval(fetchNotifications, 60_000)` runs only while `open === true`
  and is cleaned up on close. Avoids constant background polling when the
  dropdown is closed.
- **`useState` for open/close** (per spec — no Radix Popover). Outside-click +
  Escape handled with a `useEffect` listener attached only while open (no
  global listener leak). `mousedown` is used (not `click`) so a drag-selection
  that starts inside the dropdown doesn't close it.
- **Optimistic mark-all-read.** After a successful `POST { readAll: true }`,
  the local `notifications` array is mapped to `{ ...item, read: true }` so
  the badge disappears immediately, without waiting for the next refetch.
- **Dark glassmorphism + fuchsia/rose accent palette** to match the existing
  `top-bar` / `theme-toggle` / `share-dialog` / `profile-view` aesthetic. No
  indigo/blue. Custom scrollbar styling for the dropdown list
  (``) per the project UI rules.

## API contract

- `GET /api/notifications`
  - 200: `{ notifications: NotificationItem[] }` — newest first, max 30.
  - 401: `{ error: "Unauthorized" }` — no session.
  - 500: `{ error: "Failed to load notifications." }` + server-side `console.error`.
- `POST /api/notifications`
  - Body: `{ readAll: true }` (any other shape is a 400).
  - 200: `{ success: true, updated: number }` — `updated` is the count of rows
    flipped from `read: false` → `read: true`. Idempotent: returns `updated: 0`
    when nothing was unread.
  - 400: `{ error: string }` — invalid JSON body or bad shape.
  - 401: `{ error: "Unauthorized" }`.
  - 500: `{ error: "Failed to mark notifications as read." }` + server-side `console.error`.

## Bell component behavior

- Bell button: `size-8`, `rounded-full`, dark glass background, hover/focus
  states. `aria-label="Notifications"` (or `Notifications (N unread)` when
  there are unread items), `aria-haspopup="menu"`, `aria-expanded={open}`.
- Red unread badge: absolute top-right of the bell button. Gradient
  `from-rose-500 to-red-600`, white bold text, ring-2 ring-black for contrast
  against the bell background. Shows `99+` when count exceeds 99. Hidden when
  count is 0. `aria-hidden` (the bell's label already conveys the count to
  screen readers).
- Dropdown: absolute right-0 below the button, `w-[min(22rem,calc(100vw-2rem))]`
  so it never overflows on mobile. Dark glassmorphism (`bg-black/80
  backdrop-blur-xl backdrop-saturate-150`), `rounded-2xl`,
  `border border-white/[0.08]`, `shadow-2xl shadow-black/60`. Subtle fade/zoom
  in.
- Header: "Notifications" title + "Mark all as read" button (disabled when
  already all-read or when a mark request is in-flight, with a `Loader2`
  spinner during the request).
- List: max-h-96 with custom thin scrollbar. Each row: type-icon chip (with
  per-type gradient + ring) + title + (optional) 2-line body + relative time
  ("3 minutes ago"). Unread rows get a subtle `bg-white/[0.025]` tint + a
  2px-wide fuchsia→rose gradient accent bar on the left edge.
- Empty state: "No notifications" + a sub-text explaining what shows up here
  (new followers, likes, generation updates).
- Loading state: spinner + "Loading…" centered in the body.
- Closes on: outside click, Escape key, or clicking the bell button again.

## Integration TODOs (for the orchestrator)

1. **Merge `prisma/schema-notifications.md`** into `prisma/schema.prisma`:
   - Add the new `Notification` model exactly as documented.
   - Add `notifications Notification[]` to the `User` model.
2. **Run `bun run db:push`** to materialize the table + index + regenerate the
   Prisma client. After this, the route file's `db.notification.*` calls will
   type-check and work at runtime.
3. **Mount `<NotificationBell />` in the top bar.** Add it next to
   `<ThemeToggle />` in `src/components/music/top-bar.tsx`:
   ```tsx
   import { NotificationBell } from "./notification-bell";
   // …inside the right-side action cluster:
   <ThemeToggle />
   <NotificationBell />
   <button …>Create</button>
   ```
   No props required (the optional `className` is for positioning only).
4. **Wire notification writers** (other Phase 4 agents own these; documented in
   the schema md): each event creator should call
   `db.notification.create({ data: { userId, type, title, body? } })` inside a
   `try/catch` so a notification failure never breaks the primary operation.
   - `follow` event → written by `POST /api/follow` (recipient = followed user).
   - `like` event → written by the like endpoint when `liked` flips false→true.
   - `generation` event → written by `POST /api/generate` after synth success/failure.
   - `system` event → written by the platform (welcome-on-signup, etc.).

## Verification

- `bun run lint` → **0 errors, 0 warnings** in my 3 files (the only project-wide
  lint output is the `.md` "no config" warning for `schema-notifications.md`,
  which is expected + harmless — ESLint has no markdown config).
- `npx tsc --noEmit` → my files have 2 errors in `route.ts`, both
  `Property 'notification' does not exist on type 'PrismaClient'`. These are
  the expected pre-merge errors that clear the moment the orchestrator merges
  the schema + runs `db:push` (same pattern as Tasks 2-A/2-D/3-A/3-D).
  `notification-bell.tsx` has **0 TypeScript errors**.
- Dev log: no errors attributed to my files. The only compile errors in the log
  are the pre-existing `ThemeToggle` named-export mismatch in `top-bar.tsx`
  (another agent's file, not touched by me).
- Did NOT modify any other agent's files (no `schema.prisma`, no `types.ts`,
  no other API routes, no other components, no layout, no `globals.css`, no
  middleware, no `lib/`). Did NOT start/stop the dev server.
