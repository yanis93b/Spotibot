/**
 * src/lib/playlist-mapper.ts
 *
 * Maps a Prisma `Playlist` row (with its items + nested songs) to the public
 * `Playlist` type exposed over the API. Computes trackCount + total duration
 * from the joined items.
 */

import type { Playlist as DbPlaylist } from "@prisma/client";
import type { Playlist } from "@/lib/types";

// The Prisma payload type when items + song are included.
type PlaylistWithItems = DbPlaylist & {
  items: Array<{ song: { durationMs: number } }>;
};

export function toPublicPlaylist(row: PlaylistWithItems): Playlist {
  const trackCount = row.items.length;
  const durationMs = row.items.reduce(
    (sum, item) => sum + (item.song?.durationMs ?? 0),
    0,
  );
  return {
    id: row.id,
    name: row.name,
    trackCount,
    durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export default toPublicPlaylist;
