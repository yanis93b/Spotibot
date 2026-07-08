# Task C-4 — Onboarding component

**Agent:** C-4 (onboarding)
**File owned:** `src/components/music/onboarding.tsx`
**Status:** ✅ Done — lint clean (exit 0), no TS errors in the file, no compile errors in dev.log.

## What was built

A self-contained, multi-step onboarding modal that appears for first-time
SpotiBot users. Detected via `localStorage.getItem("spotibot-onboarded")`
being null on mount. No props — the component mounts itself, checks storage
inside a `useEffect`, and opens the dialog when appropriate.

### Steps

1. **Welcome** — SpotiBot logo (`/public/logo.svg`) with a soft fuchsia glow,
   "Welcome to SpotiBot!" headline, the exact description copy from the spec,
   and a gradient "Get started" button → step 2.

2. **Set username** — shadcn `Input` (3–20 chars, lowercase alphanumeric +
   single hyphens — same regex as `PATCH /api/profile/me`). Live preview
   `/u/your-username` updates as the user types. Uses `useSession()` to gate
   the input:
   - `status === "loading"` → inline spinner.
   - `status === "authenticated"` → editable input + "Continue" (PATCHes
     `/api/profile/me` with `{ username }`) + "Skip".
   - `status === "unauthenticated"` → amber note explaining they need to sign
     in to claim a username; only "Continue" (acts as a skip) is offered.
   On 200 → toast "Username saved" + advance. On 400 (validation / taken) →
   inline error + destructive toast, stay on step. On 401 → toast "Sign in to
   set a username" + advance (treated as a skip). On network error →
   destructive toast + stay.

3. **Feature tour** — three cards (Generate / Browse / Share) with icons
   (Wand2 / Compass / Share2) and the exact copy from the spec. "Done" button
   writes the onboarded flag + closes the dialog.

### General behaviour

- **shadcn `Dialog`** — the built-in X button, ESC, and backdrop click all
  flow through `onOpenChange`, which calls `complete()` (writes the flag +
  closes). So the user is never re-prompted after dismissing.
- **Progress dots** — 3 dots at the bottom; current step's dot is fuchsia and
  wider (`w-6`); completed steps are `bg-foreground/60` and clickable to
  navigate back; future steps are dim (`bg-white/15`) and not interactive.
  Users must use the primary buttons to advance (dots can only go backwards).
- **Framer Motion** — `AnimatePresence mode="wait"` with slide+fade transitions
  between steps (`x: 24 → 0 → -24`, `opacity: 0 → 1 → 0`, 0.22s easeOut).
- **SSR-safe** — `mounted` state guards the entire flow. The dialog is never
  open during SSR (`open` starts `false`, only set `true` inside `useEffect`),
  so there's no hydration mismatch.
- **Storage-robust** — every `localStorage` access is wrapped in try/catch
  (private mode / disabled storage). On read failure, treated as
  "not onboarded yet"; on write failure, a warning is logged but the in-memory
  `open` state still closes the modal.

## Conventions followed

- **Dark glass styling** — `bg-[#1a1a22]`, `border-white/10`, matching the
  other modal dialogs (`share-dialog.tsx`, `create-playlist-dialog.tsx`).
- **Fuchsia→violet→rose gradient accents** on primary buttons; no indigo/blue.
- **`useToast()`** for all feedback (success + destructive) — routes to the
  already-mounted `<Toaster/>` from `layout.tsx`.
- **Username sanitiser** mirrors `settings-view.tsx`'s
  `sanitizeUsernameInput` (lowercase + strip non-`[a-z0-9-]` + collapse `--`)
  so onboarding + settings never disagree.
- **Local type duplication** pattern not needed here (no API response types
  are consumed — only PATCHed).
- **Accessibility**: `DialogTitle` + `DialogDescription` are present but
  visually hidden (sr-only) so Radix gets its required title while the visible
  headings stay flexible inside each step. The username input has
  `aria-invalid` + `aria-describedby` pointing at the role="alert" error `<p>`.
  Feature list is wrapped in `<ul aria-label="Key features">`. Progress dots
  have `aria-current="step"` + descriptive `aria-label`s. Decorative icons
  are `aria-hidden`.
- **Mobile-first**: dialog uses `sm:max-w-md`, full-width buttons on mobile,
  stack-to-row footer actions.
- **TypeScript strict, no `any`**. `StepIndex` is a `0 | 1 | 2` literal union.

## Files touched

- **Created** `src/components/music/onboarding.tsx` (only file owned).
- **Did NOT modify** any other file — no schema, no types, no API routes, no
  layout, no globals.css, no other components. No dev server started/stopped.

## Verification

- `cd /home/z/my-project && bun run lint` → **EXIT 0**, 0 errors/warnings
  project-wide.
- `npx tsc --noEmit` → 0 errors in `onboarding.tsx` (pre-existing TS errors in
  other agents' WIP files were not touched).
- `dev.log` tail → no compile errors attributed to `onboarding.tsx`.

## Integration TODOs (for the orchestrator)

1. **Mount `<Onboarding />` once at the app root** so it appears on every
   route for first-time users. The natural spot is `src/app/layout.tsx`
   alongside the existing `<SessionProvider>` + `<Toaster />`, e.g.:

   ```tsx
   <SessionProvider>
     {children}
     <Toaster />
     <Onboarding />
   </SessionProvider>
   ```

   It renders `null` during SSR and after onboarding is complete, so it's
   cheap to mount globally.

2. **Re-trigger onboarding on sign-out (optional)** — if you want signed-out
   users to re-onboard after signing back in, clear the `spotibot-onboarded`
   flag in the signOut flow. The component does not do this itself (the spec
   says first-time users, detected purely by the localStorage flag).

3. **Theme**: the modal is hard-styled for dark mode (`bg-[#1a1a22]`,
   `border-white/10`, fuchsia gradient). If a light-mode variant is ever
   needed, swap those classes for theme-token equivalents
   (`bg-card`, `border-border`, `bg-primary`). The rest of the component
   already uses semantic tokens (`text-foreground`, `text-muted-foreground`).
