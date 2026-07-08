# Task 2-C — Agent: theme-toggle

## Task
Build the theme toggle for SpotiBot (Phase 2): a localStorage-persisted light/dark switch, plus a no-flash theme-init client component.

## Files owned (created ONLY these)
- `src/components/music/theme-toggle.tsx` — Sun/Moon icon button (size-8, icon size-4, rounded-full, ghost variant, `aria-label="Toggle theme"`), toggles the `dark` class on `<html>` and persists to `localStorage` under `spotibot-theme`.
- `src/lib/theme-init.tsx` — default-export client component rendering `null`; a `useEffect` reads `localStorage.getItem("spotibot-theme")` (default `"dark"`) and adds/removes the `dark` class on `document.documentElement`. Also exports `SPOTIBOT_THEME_KEY` + `SpotibotTheme` type, reused by the toggle.

## Implementation notes
- Did NOT modify `src/app/layout.tsx` or any other existing file (the `<html className="dark">` and `:root`/`.dark` CSS vars in `globals.css` were already in place). The orchestrator is expected to mount `<ThemeInit/>` high in the tree (e.g. top of `<body>`) and `<ThemeToggle/>` wherever the toggle should appear.
- For the toggle, the initial state MUST match SSR to avoid a React hydration mismatch. Since the layout forces `className="dark"` and `getServerSnapshot()` returns `"dark"`, the SSR markup and the first client paint agree. The snapshot is then re-read from `localStorage` on the client.
- Used `useSyncExternalStore` (instead of `useState` + `useEffect(setState)`) to avoid the `react-hooks/set-state-in-effect` lint error AND to get cross-tab sync for free via the native `storage` event. A custom `spotibot:theme-change` event is dispatched after each in-tab toggle so the local subscription re-reads.
- The DOM class is kept in sync via a dedicated `useEffect([theme])` that only mutates `classList` (no setState) — the recommended "synchronize with external system" pattern.
- All `localStorage` reads/writes are wrapped in `try/catch` for private-mode / quota / disabled-storage robustness; the dark default still applies on failure.
- Strict TS throughout (no `any`), accessible (`aria-label`, `title` tooltip), uses shadcn `Button` (ghost/icon) + lucide-react `Sun`/`Moon` icons.

## Lint
`cd /home/z/my-project && bun run lint` → CLEAN (0 errors, 0 warnings) across the whole project.

## Did NOT touch
Any file outside the two owned ones (no layout, no globals.css, no other components, no API routes, no prisma, no lib/ai).
