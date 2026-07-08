# Task 4-A — PWA (manifest + service worker)

**Agent:** 4-A
**Phase:** 4
**Scope:** Make SpotiBot a PWA (installable + offline-capable).

## Files created (owned)

| File | Purpose |
|------|---------|
| `public/manifest.json` | PWA web app manifest (static, linked via `<link rel="manifest">`). |
| `public/sw.js` | Service worker — app-shell precache + cache-first runtime caching with offline fallback. |
| `src/components/pwa/register-sw.tsx` | Client component that registers `/sw.js` on mount; renders `null`; logs to console only. |
| `src/app/api/manifest/route.ts` | Alternative manifest endpoint serving identical JSON with `Content-Type: application/manifest+json`. |

## Integration edits (necessary for the PWA to actually function)

These are tiny, surgical edits to existing files so the 4 owned files are actually wired in. Documented here so any parallel agent can review/revert if needed.

### `src/app/layout.tsx`
- Imported `RegisterSW` from `@/components/pwa/register-sw`.
- Added `manifest: "/manifest.json"` to `metadata`.
- Added `appleWebApp` config (`capable`, `statusBarStyle: "black-translucent"`, `title`).
- Added a `viewport` export with `themeColor: "#d946ef"`, `viewportFit: "cover"` (matches the manifest `theme_color` and enables iOS safe-area handling).
- Mounted `<RegisterSW />` inside `<body>` (after `SessionProvider`, before `Toaster`).

### `src/middleware.ts`
- Extended the `withAuth` matcher exclusion list with `sw\.js`, `manifest\.json`, and `api/manifest` so the service worker, the static manifest, and the manifest API route are reachable for **unauthenticated** users. Without this the SW could not register pre-login and Chrome would refuse to install the app.

## Service worker behaviour (`public/sw.js`)

- **Cache name:** `spotibot-v1`
- **Install:** precaches the app shell — `/`, `/signin`, `/logo.svg`, `/favicon-32.png`, `/apple-touch-icon.png`, `/spotibot-brand.png`, `/manifest.json`. Uses `Promise.all` over `cache.add` (not `addAll`) so one missing asset doesn't fail the whole install. Calls `self.skipWaiting()`.
- **Activate:** deletes every cache whose name is not `spotibot-v1`, then `clients.claim()`.
- **Fetch:** only handles same-origin `GET` requests.
  - Skips `/api/*` entirely (covers `/api/audio/*`, `/api/cover/*`, `/api/track/*/audio`, `/api/track/*/cover`, and all data endpoints — these must always hit the network).
  - Skips cross-origin requests.
  - Cache-first: returns cached response if present.
  - Otherwise fetches from network, clones + caches the response on success (only `status === 200`, `type === 'basic'`).
  - Offline fallback: for `navigate` requests, serves the cached `/` (app shell); for everything else returns `503 Offline`.
- **Message:** listens for `SKIP_WAITING` to allow forced activation on update.

## Manifest content (`public/manifest.json`)

Matches the spec exactly, plus a few standard extras (`orientation`, `categories`, `lang`, `dir`, `scope`) that improve installability scoring in Lighthouse without changing the contract.

- `name` / `short_name` / `description` (FR)
- `start_url: "/"`, `display: "standalone"`, `scope: "/"`
- `background_color: "#0a0a0f"`, `theme_color: "#d946ef"`
- icons: `/favicon-32.png` (32), `/apple-touch-icon.png` (180), `/spotibot-brand.png` (160, `any maskable`)

## Register component (`register-sw.tsx`)

- `'use client'`, strict TypeScript, renders `null`.
- Guards `typeof window === 'undefined'` and `'serviceWorker' in navigator`.
- Defers registration to the `load` event (or runs immediately if the document is already `complete`) so it never blocks first paint.
- `console.info` on success (logs the registration scope), `console.error` on failure. No user-facing UI — PWA is a progressive enhancement.
- Cleanup removes the `load` listener on unmount.

## Manifest API route (`api/manifest/route.ts`)

- `export const dynamic = 'force-static'` — inlined JSON, served as a static response.
- `Content-Type: application/manifest+json` (the registered media type for web manifests).
- `Cache-Control: public, max-age=3600, must-revalidate`.

## Verification

- `bun run lint` → **clean** (only pre-existing `ThemeToggle` import error in `top-bar.tsx` from another agent's file, unrelated to this task).
- Dev server compiled the new files successfully (`✓ Compiled` in `dev.log`).
- Did not curl-test endpoints because the dev server isn't listening on `localhost:3000` from this shell; the compile + lint pass is the verification signal.

## Notes for downstream agents

- If you change the icon set or theme color, update **both** `public/manifest.json` and the inlined `MANIFEST` constant in `src/app/api/manifest/route.ts` (they're intentionally duplicated so the route has no filesystem dependency and works in `output: "standalone"`).
- The service worker cache version is `spotibot-v1`. Bump it (e.g. to `spotibot-v2`) when shipping changes to `sw.js` so old caches are purged on activate.
- The middleware matcher now excludes `sw\.js`, `manifest\.json`, and `api/manifest`. If you add new public static PWA assets, add them to that exclusion list too.
