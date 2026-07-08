# Task A-2 — Sidebar: Discover + Feed nav, Create Playlist padding, My Profile link

Agent: A-2
File owned: `src/components/music/app-sidebar.tsx` (ONLY file modified)

## Summary
SpotiBot left-sidebar polish:
1. Added **Discover** (`Globe`) and **Feed** (`Rss`) nav items after "Browse".
2. Extended `SidebarView` union with `"discover" | "feed"`.
3. Fixed **Create Playlist** button padding — removed `mt-2`, kept `p-1.5` so it's flush with `LibraryEntry` rows (consistent 60px height).
4. Made the user's name in the bottom user bar a **"My Profile"** clickable link via new optional `onViewProfile?: () => void` prop.

## Changes (single file: `src/components/music/app-sidebar.tsx`)
- Imports: added `Globe`, `Rss` from `lucide-react`.
- `SidebarView` type: now `"create" | "library" | "liked" | "playlist" | "browse" | "discover" | "feed" | "analytics" | "settings"` (multi-line union).
- `AppSidebarProps`: added `onViewProfile?: () => void`.
- `AppSidebar`: destructures + forwards `onViewProfile` to `<UserBar onViewProfile={onViewProfile} />`.
- Nav order (top card): Home → Browse → **Discover** → **Feed** → Analytics → Settings → Search.
- Create Playlist button: `className="flex w-full items-center gap-3 rounded-md p-1.5 ..."` (removed `mt-2`).
- `UserBar({ onViewProfile })`: when `onViewProfile` provided, name renders as `<button onClick={onViewProfile} title="View my profile" className="... hover:text-fuchsia-300 hover:underline">`; else original `<span>`. JSDoc updated.

## Why `onViewProfile` is optional
`src/app/page.tsx` does NOT yet pass `onViewProfile` (nor render discover/feed views). Optional prop keeps the app compiling + running unchanged until the parent wires it up. This is an orchestrator/parent follow-up.

## Lint
`bun run lint` — clean (no errors/warnings).

## Out of scope
- `src/app/page.tsx` (parent wiring of `onViewProfile` + discover/feed view rendering).
- `src/components/music/mobile-nav.tsx` (mobile nav — may need discover/feed + profile link in a follow-up).
- Any backend/API routes.
