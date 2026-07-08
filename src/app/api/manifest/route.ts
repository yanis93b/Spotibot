import { NextResponse } from 'next/server';

/**
 * Serves the PWA web manifest at `/api/manifest`.
 *
 * This is an alternative to the static `public/manifest.json` file (which is
 * served at `/manifest.json`). Both expose identical JSON; the static file is
 * what the `<link rel="manifest">` tag points at, while this route exists for
 * clients that prefer a typed, cacheable endpoint with the correct
 * `application/manifest+json` content type.
 */

const MANIFEST = {
  name: 'SpotiBot — Le bot de musique moderne',
  short_name: 'SpotiBot',
  description: 'Génère des morceaux originaux à partir d\'un prompt texte.',
  start_url: '/',
  display: 'standalone',
  background_color: '#0a0a0f',
  theme_color: '#d946ef',
  orientation: 'any',
  categories: ['music', 'entertainment', 'productivity'],
  lang: 'fr',
  dir: 'ltr',
  scope: '/',
  icons: [
    { src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    {
      src: '/spotibot-brand.png',
      sizes: '160x160',
      type: 'image/png',
      purpose: 'any maskable',
    },
  ],
} as const;

export const dynamic = 'force-static';

export async function GET() {
  return new NextResponse(JSON.stringify(MANIFEST), {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600, must-revalidate',
    },
  });
}
