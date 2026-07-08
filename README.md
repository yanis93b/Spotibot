# Spotibot — AI Music Generation Studio

A Spotify-like web interface for generating original songs with AI. Powered by the open-source **Ace Music** (ACE-Step v1.5 turbo) model for real text-to-music synthesis, with AI-generated cover art for every track.

![AceMusic Studio](https://img.shields.io/badge/Ace%20Music-v1.5%20turbo-f0abfc) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## Features

### Music generation (real Ace Music model)
- **Text-to-music synthesis** — describe a vibe, get a full sung track (vocals + instrumentation)
- **Simple / Custom mode** — let the LLM write lyrics, or write your own
- **All model parameters** — duration, BPM, key, time signature, audio format (MP3/WAV/FLAC/Opus/AAC), seed (reproducible), high-quality LM planning
- **AI cover art** — a unique 1024×1024 cover is generated for every track (in parallel with the audio)
- **10 vocal languages** — English, 中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, Italiano

### Spotify-like interface
- **3-panel layout** — sidebar (nav + library + playlists) / main content / now-playing right panel
- **Sticky bottom player** — cover, transport (shuffle/prev/play/next/repeat), seek bar, volume, download
- **Track list table** — Spotify-style (#, cover+title, album, like, duration) with hover-play
- **Carousels** — "Recently generated" horizontal scroll
- **Playlists** — create / rename / delete / add tracks / remove tracks (ordered, with cascade deletes)
- **Likes** — favorite tracks with a dedicated "Liked Songs" view
- **Search** — filter the library by title, genre, mood, or lyrics
- **Quick-access tiles** on the home page (Spotify Home style)
- **Mobile responsive** — sidebar collapses, bottom tab bar appears

### UX
- **Keyboard shortcuts** — Space (play/pause), ←/→ (seek), ↑/↓ (volume), M (mute), L (like), N/P (next/prev)
- **Live generation timer** with adaptive messages + Cancel button (AbortController)
- **Rate-limit handling** — 429 from Ace Music shows a countdown banner + disables Generate until reset
- **Copy button on toasts** — copy any error/message to clipboard
- **Dark theme** with fuchsia/violet/rose accents

## Tech stack
- **Next.js 16** (App Router) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York) + **Lucide** icons
- **Prisma ORM** + **SQLite** (audio bytes + cover art stored inline)
- **Zustand** (player state) + **framer-motion** (animations)
- **z-ai-web-dev-sdk** (LLM lyricist + image generation for covers)
- **Ace Music cloud API** (ACE-Step v1.5 turbo — OpenAI-compatible `/v1/chat/completions`)

## Getting started

### 1. Install dependencies
```bash
bun install
```

### 2. Configure environment
Copy the example and fill in your keys:
```bash
cp .env.example .env
```
Required:
- `ACE_API_KEY` — get one at https://acemusic.ai/api-key
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`

Optional:
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — for GitHub OAuth (create at https://github.com/settings/developers, callback URL: `http://localhost:3000/api/auth/callback/github`)
- `NEXT_PUBLIC_GITHUB_ENABLED=true` — to show the GitHub button on the sign-in page

### 3. Set up the database
```bash
bun run db:push
```

### 4. Run the dev server
```bash
bun run dev
```
Open http://localhost:3000 — you'll be redirected to `/signin` to create an account.

### Authentication
SpotiBot uses NextAuth.js with two providers:
- **Email + password** (works out of the box — sign up on the `/signin` page)
- **GitHub OAuth** (optional — enable by setting `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`)

Every user has their own library, playlists, and liked tracks. Data is scoped by `ownerId` — no user can see another's data.

## Production deployment

### Database (PostgreSQL)
For production, switch from SQLite to PostgreSQL:
1. Create a Postgres DB (Neon: https://neon.tech, Supabase: https://supabase.com — both free)
2. Edit `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Set `DATABASE_URL` to your Postgres connection string
4. Run `bun run db:push`

### Storage (S3/R2)
Audio + cover bytes are stored inline in SQLite for demo-scale. For production, move them to object storage:
1. Create a Cloudflare R2 bucket (https://r2.dev — 10GB free) or AWS S3
2. Upload audio/cover bytes on generation instead of storing in DB
3. Serve via presigned URLs or a CDN

### Deploy to Vercel
1. Push your repo to GitHub
2. Import at https://vercel.com/new
3. Set all env vars in the Vercel dashboard
4. Set `NEXTAUTH_URL` to your production URL (e.g. `https://spotibot.vercel.app`)
5. Deploy

### GitHub OAuth for production
1. Go to https://github.com/settings/developers → "New OAuth App"
2. Homepage URL: your production URL
3. Authorization callback URL: `https://your-domain/api/auth/callback/github`
4. Copy Client ID + Client Secret to your env vars

## Project structure
```
src/
├─ app/
│  ├─ page.tsx                    # Main orchestration (3-panel layout)
│  ├─ layout.tsx                  # Dark theme root
│  └─ api/
│     ├─ generate/                # POST: lyrics → Ace Music → cover → persist
│     ├─ songs/                   # GET list / DELETE / PATCH (like toggle)
│     ├─ playlists/               # GET/POST + [id] CRUD + tracks add/remove
│     ├─ audio/[id]/              # Stream the generated MP3/WAV
│     ├─ cover/[id]/              # Stream the AI cover PNG
│     └─ health/ace/              # Ace Music API status
├─ components/music/              # Spotify-style UI components
│  ├─ app-sidebar.tsx             # Left nav + library + playlists
│  ├─ bottom-player.tsx           # Sticky player bar (owns <audio>)
│  ├─ track-list.tsx              # Spotify table with add-to-playlist menu
│  ├─ now-playing-panel.tsx       # Right panel (cover + lyrics + attrs)
│  ├─ prompt-composer.tsx         # Simple/Custom mode + all model params
│  ├─ cover-image.tsx             # AI cover with gradient fallback
│  ├─ create-playlist-dialog.tsx  # Modal
│  ├─ mobile-nav.tsx              # Bottom tab bar (mobile)
│  └─ generation-loader.tsx       # Timer + cancel
├─ lib/
│  ├─ ai/
│  │  ├─ ace-client.ts            # Ace Music API client + RateLimitError
│  │  ├─ audio-synth.ts           # Swappable synth adapter
│  │  ├─ lyrics-generator.ts      # LLM lyricist
│  │  ├─ cover-generator.ts       # AI cover art (image-gen)
│  │  └─ zai-instance.ts          # SDK singleton
│  ├─ player-store.ts             # Zustand audio state
│  ├─ types.ts                    # Shared domain types
│  └─ db.ts                       # Prisma client
└─ hooks/
   ├─ use-songs.ts                # Library state
   ├─ use-playlists.ts            # Playlist state
   └─ use-keyboard-shortcuts.ts   # Space/arrows/M/L/N/P
```

## API documentation

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/generate` | Generate a song (lyrics + audio + cover) |
| `GET` | `/api/songs` | List all songs |
| `DELETE` | `/api/songs/[id]` | Delete a song |
| `PATCH` | `/api/songs/[id]` | Toggle like |
| `GET` | `/api/playlists` | List playlists |
| `POST` | `/api/playlists` | Create a playlist |
| `GET` | `/api/playlists/[id]` | Get a playlist with its tracks |
| `PATCH` | `/api/playlists/[id]` | Rename a playlist |
| `DELETE` | `/api/playlists/[id]` | Delete a playlist |
| `POST` | `/api/playlists/[id]/tracks` | Add a song to a playlist |
| `DELETE` | `/api/playlists/[id]/tracks?songId=` | Remove a song from a playlist |
| `GET` | `/api/audio/[id]` | Stream the generated audio |
| `GET` | `/api/cover/[id]` | Stream the AI cover art |
| `GET` | `/api/health/ace` | Ace Music API status |

## Notes
- The Ace Music free API limits to **120 generations/hour**. The UI surfaces a live countdown when this limit is hit.
- Audio + cover bytes are stored inline in SQLite (demo-scale). For production, move to object storage (S3/R2).
- The audio synthesis adapter (`src/lib/ai/audio-synth.ts`) is swappable — to use a different model, only that file needs to change.

## License
MIT
