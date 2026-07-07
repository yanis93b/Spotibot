/**
 * src/lib/song-mapper.ts
 *
 * Maps a Prisma `Song` row (which includes raw `audioData` bytes) to the
 * public `Song` type exposed over the API. The public shape:
 *   - strips the heavy `audioData` field (clients fetch bytes via audioUrl),
 *   - derives `audioUrl` from the row id,
 *   - serializes `createdAt` to an ISO string.
 *
 * Aliasing the Prisma type as `DbSong` avoids a name clash with the public
 * `Song` interface imported from `@/lib/types`.
 */

import type { Song as DbSong } from "@prisma/client";
import type { Song } from "@/lib/types";

export function toPublicSong(row: DbSong): Song {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    lyrics: row.lyrics,
    genre: row.genre,
    mood: row.mood,
    style: row.style,
    voice: row.voice,
    audioUrl: `/api/audio/${row.id}`,
    audioFormat: row.audioFormat,
    durationMs: row.durationMs,
    liked: row.liked,
    createdAt: row.createdAt.toISOString(),
  };
}
