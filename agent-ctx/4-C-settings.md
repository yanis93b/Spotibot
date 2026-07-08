# Task 4-C — Settings View (Agent 4-C)

**Task ID:** 4-C
**Agent:** settings
**Phase:** 4 of SpotiBot
**File owned:** `src/components/music/settings-view.tsx`

## What was built

A self-contained `'use client'` Settings page for SpotiBot with three dark-glass sections inside a centered `max-w-3xl` container on the `music-bg` backdrop.

### Section 1 — Profile (editable)
- `Name` shadcn `Input` (`maxLength=80`, live `name.trim().length/80` counter).
- `Username` `Input` with an `AtSign` leading icon, `maxLength=20`. The `onChange` handler runs `sanitizeUsernameInput` (lowercase + strip every char that isn't `[a-z0-9-]` + collapse `--`) so the displayed value can never drift from what the server's regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` will accept.
- `Bio` `Textarea` (`maxLength=200`, `bio.length/200` counter).
- Save button → PATCH `/api/profile/me`. Builds a body containing ONLY the changed fields (`name` / `username` / `bio`); empty bio is sent as `null` to clear it on the server (matches the route's zod `.nullable()` schema).
- Reset button (ghost) restores the last-saved values when dirty.
- Submit disabled while saving, when not dirty, or when there's a validation error.
- Fetches current values from GET `/api/profile/me` on mount via `useEffect` with `cache: "no-store"`.
- Toasts on success ("Profile saved") + error (destructive variant, surfaces the server's `{ error }` message).

### Section 2 — Track visibility
- Fetches the user's tracks from GET `/api/songs` on mount.
- Each row: `CoverImage` (44px, reuses the shared component — AI PNG or deterministic gradient fallback) + title + "Public"/"Private" status pill with `Eye`/`EyeOff` icon + genre·mood meta + shadcn `Switch`.
- Toggling the Switch fires PATCH `/api/songs/[id]` with `{ isPublic: boolean }`. Optimistic UI: flips the local state immediately, rolls back on any non-2xx response. While a request is in-flight, the pending track's Switch is disabled via `pendingTrackId` state.
- Toasts confirm the new visibility ("Track is now public"/"…private") on success and surface the server's error message on failure.
- Empty state ("No tracks yet") when the user has zero tracks. Skeleton row list during initial load. Rose-tinted error banner with retry on fetch failure.

### Section 3 — Account
- `Email` (readonly) — pulled from `useSession()` client-side (the profile endpoint deliberately omits email from its public response shape).
- `Member since` (readonly, formatted via `Date.toLocaleDateString` with `{ year: 'numeric', month: 'long', day: 'numeric' }`).
- `Sign out` button — calls `signOut({ callbackUrl: "/signin" })` from `next-auth/react` (same pattern as `app-sidebar.tsx`).
- `Delete account` button — red (`variant="destructive"`, `bg-rose-600/90`), opens an `AlertDialog` confirm dialog (AlertTriangle icon + clear copy: "This action is permanent… please contact our support team"). The `AlertDialogAction` is a placeholder: it shows a toast "Contact support to delete your account" per spec. No destructive call is made.

## Implementation notes

- **Forward-compatible `isPublic`:** the public `Song` type in `@/lib/types` does NOT yet carry `isPublic`. The discover-trending agent (Task 3-C) added a schema addendum (`prisma/schema-discover.md`) plus an orchestrator TODO to (a) add `isPublic Boolean @default(false)` to the Song model, (b) extend PATCH `/api/songs/[id]` to accept `{ isPublic?: boolean }`, and (c) expose the field via `toPublicSong`. We mirror that future shape locally as `SettingsSong = Song & { isPublic?: boolean }` and treat `undefined` as "private" (the schema default) — so the component works today (every Switch reads `song.isPublic ?? false`) and continues to work after the orchestrator merges the schema.
- **TypeScript strict, no `any`:** every fetch response is typed (`PublicProfileResponse`, `{ songs: SettingsSong[] }`, `{ user?: PublicProfileUser; error?: string }`, `{ error?: string }` for the toggle error path). `catch (e)` blocks log the unknown error server-side and surface a generic message to the user.
- **`useToast` from `@/hooks/use-toast`:** routes to the existing `<Toaster/>` mounted in `layout.tsx`. Success toasts use the default variant; failures use `variant: "destructive"`.
- **Local type duplication:** `PublicProfileUser` and `PublicProfileResponse` are copied locally rather than imported from the route file — matches the convention in `profile-view.tsx` (avoids bundling server-only route code into the client bundle).
- **Accessibility:** every icon-only control has an `aria-label`; the `Switch`'s label includes the track title; form `Label`s are associated with their inputs by `htmlFor`; the bio/username/name errors are surfaced via `aria-invalid` + `aria-describedby` pointing at a `role="alert"` `<p>`; the section headers use semantic `<section aria-label>`; the loading skeletons set `aria-busy="true"`.
- **Lint rule compliance:** `useCallback` for every handler that's a child prop or effect dep; `useMemo` for derived validation/dirty state; no `useRef` accessed during render (initially used `useRef` for the skeleton row array — caught and fixed by `react-hooks/refs` lint rule; replaced with a module-scope `as const` array).
- **Sticky footer / layout:** the component renders inside a `min-h-screen` wrapper so it can be dropped into any parent that supplies the sidebar/top-bar shell. No footer is rendered by this component — the parent owns the footer.
- **Styling:** dark theme only; glassmorphism via `.glass-card`; fuchsia→violet→rose gradient accents; no indigo/blue.

## Validation rules (mirror server's zod schema)

| Field    | Min | Max | Pattern                                |
| -------- | --- | --- | -------------------------------------- |
| name     | 1   | 80  | (any, trimmed)                         |
| username | 3   | 20  | `^[a-z0-9]+(?:-[a-z0-9]+)*$`           |
| bio      | 0   | 200 | (any)                                  |

## Self-check

- `cd /home/z/my-project && bun run lint` → **EXIT 0**, 0 errors/warnings in my file (and project-wide).
- `npx tsc --noEmit` → **0 errors** in `src/components/music/settings-view.tsx`. (Pre-existing errors in other agents' WIP files — `top-bar.tsx`'s `ThemeToggle` named-export mismatch, plus the future-schema Prisma errors in `feed`/`follow`/`discover`/`trending` — were NOT touched.)
- Dev log: no compile errors attributed to `settings-view.tsx`. (Only the pre-existing `ThemeToggle` mismatch in `top-bar.tsx` shows up — not my file.)
- Did NOT modify any other file. No schema, no types.ts, no API routes, no other components, no layout, no globals.css.
- Did NOT start/stop the dev server.

## Integration TODOs for the orchestrator

1. Mount `<SettingsView />` somewhere in the app — natural integration point is a new `SidebarView` value (e.g. `"settings"`) + a sidebar nav entry (the `Settings` icon is already imported as `SettingsIcon` here; the sidebar can import the lucide `Settings` icon the same way). Render `<SettingsView />` in `page.tsx` when `view === "settings"`.
2. Merge `prisma/schema-discover.md` into `prisma/schema.prisma` (add `isPublic Boolean @default(false)` to the `Song` model + `@@index([isPublic, createdAt])`) and run `bun run db:push` to regenerate the Prisma client. Once that lands, the existing PATCH route must be extended to accept `{ isPublic?: boolean }` (it currently only accepts `liked`) — that's also documented in `schema-discover.md`.
3. Update `toPublicSong` in `src/lib/song-mapper.ts` to expose `isPublic` on the public `Song` shape (and add the field to `Song` in `src/lib/types.ts`). Until this lands, the Switch will read every track as "Private" — functional but cosmetically wrong. After it lands, no SettingsView code change is needed (it already consumes `song.isPublic ?? false`).
4. Optionally whitelist `/api/profile/me` for the signed-in user (already auth-scoped — no middleware change needed unless the orchestrator adds a public profile route).
