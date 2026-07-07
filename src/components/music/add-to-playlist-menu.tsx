"use client";

import { useEffect, useRef, useState } from "react";
import { ListPlus, Plus, Check, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Playlist } from "@/lib/types";

export interface AddToPlaylistMenuProps {
  /** The song being added. */
  songId: string;
  /** The user's playlists. */
  playlists: Playlist[];
  /** Add the song to a playlist. Throws on error. */
  onAdd: (playlistId: string, songId: string) => Promise<void>;
  /** Open the create-playlist dialog. */
  onCreateNew: () => void;
  /** Controlled open state (optional). When omitted the menu manages itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render as a compact trigger (default). */
  triggerClassName?: string;
}

/**
 * A dropdown menu that lists the user's playlists and lets them add the
 * current song to one (or jump to "Create playlist"). Shows a spinner while
 * adding and a check when added.
 *
 * Designed to be embedded inside a track row's "more" menu.
 */
export function AddToPlaylistMenu({
  songId,
  playlists,
  onAdd,
  onCreateNew,
  triggerClassName,
}: AddToPlaylistMenuProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleAdd = async (playlistId: string) => {
    setAdding(playlistId);
    try {
      await onAdd(playlistId, songId);
      setAdded((prev) => new Set(prev).add(playlistId));
    } catch {
      // The parent surfaces errors via toast; here we just stop the spinner.
    } finally {
      setAdding(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Add to playlist"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-left text-xs text-foreground/85 transition-colors hover:bg-white/5",
          triggerClassName,
        )}
      >
        <ListPlus className="size-3.5" aria-hidden />
        Add to playlist
        <ChevronRight className="ml-auto size-3 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1 w-56 overflow-hidden rounded-lg border border-white/10 bg-[#1a1a22] shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Create new */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateNew();
            }}
            className="flex w-full items-center gap-2 border-b border-white/[0.06] px-3 py-2.5 text-left text-xs font-medium text-fuchsia-200 transition-colors hover:bg-fuchsia-500/10"
          >
            <Plus className="size-3.5" aria-hidden />
            Create new playlist
          </button>

          {/* Playlist list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {playlists.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No playlists yet. Create one above.
              </p>
            ) : (
              playlists.map((p) => {
                const isAdding = adding === p.id;
                const isAdded = added.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    disabled={isAdding || isAdded}
                    onClick={() => handleAdd(p.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/85 transition-colors hover:bg-white/5 disabled:opacity-60"
                  >
                    <span className="grid size-4 shrink-0 place-items-center">
                      {isAdding ? (
                        <Loader2 className="size-3 animate-spin text-fuchsia-300" aria-hidden />
                      ) : isAdded ? (
                        <Check className="size-3.5 text-emerald-400" aria-hidden />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AddToPlaylistMenu;
