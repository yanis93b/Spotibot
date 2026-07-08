"use client";

/**
 * src/components/music/sortable-track-list.tsx
 *
 * A drag-and-drop reorderable variant of the track list, used inside the
 * playlist view. Built on `@dnd-kit/core` + `@dnd-kit/sortable`.
 *
 * Differences vs. the plain `TrackList`:
 *  - Every row is a dnd-kit sortable item with a GripVertical drag handle.
 *  - On drag-end, the new ordering is computed (via `arrayMove`) and the
 *    parent is notified through `onReorder(orderedIds)`. The parent owns the
 *    actual API call (POST /api/playlists/[id]/reorder) and re-renders this
 *    component with the updated `songs` array.
 *  - Read-only play state is taken from the global `usePlayerStore`
 *    (the parent may also override it via the `currentId` / `isPlaying` props).
 *
 * The drag handle is the *only* drag activator: clicking anywhere else on the
 * row plays/pauses the track, exactly like the plain TrackList. The
 * PointerSensor's `activationConstraint: { distance: 6 }` further ensures a
 * tiny handle click without movement does NOT start a drag (so it doesn't
 * swallow accidental clicks). A KeyboardSensor is also wired so the list is
 * fully accessible — focus the handle, press Space to pick up, arrows to
 * move, Space/Enter to drop.
 */

import { useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { CoverImage } from "./cover-image";

export interface SortableTrackListProps {
  /** The playlist's songs in their current order. */
  songs: Song[];
  /** Fired with the new ordering (list of song ids) after a successful drag. */
  onReorder: (orderedIds: string[]) => void;
  /** Fired when the user clicks a *new* song (not the currently-playing one). */
  onPlay: (song: Song) => void;
  /** Optional override for the "current song id" (falls back to the player store). */
  currentId?: string;
  /** Whether audio is currently playing. Drives the play/pause icon. */
  isPlaying: boolean;
}

/** Format ms → m:ss. */
function fmt(ms: number): string {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

/**
 * Drag-and-drop sortable track list for the playlist view.
 *
 * State flow:
 *   user drags a row
 *     → dnd-kit fires `onDragEnd` with {active, over}
 *     → we find the source/target indices in `songs`
 *     → `arrayMove` produces the new ordering
 *     → `onReorder(next.map(s => s.id))` notifies the parent
 *     → parent POSTs to /api/playlists/[id]/reorder and updates `songs`
 *     → this component re-renders with the new order
 *
 * The visual reflow during the drag is handled entirely by dnd-kit's
 * `useSortable` hook (it applies CSS transforms to the rows that need to
 * shift out of the way). We don't need any local state for the in-flight
 * ordering.
 */
export function SortableTrackList({
  songs,
  onReorder,
  onPlay,
  currentId,
  isPlaying,
}: SortableTrackListProps) {
  // Sensors: pointer (mouse + touch) with a small activation distance so
  // a click on the handle doesn't accidentally start a drag; keyboard for
  // accessibility (Space to pick up, arrows to move, Enter/Space to drop).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // The list of ids that SortableContext tracks. Must be referentially
  // stable per render of `songs` so dnd-kit can diff positions correctly.
  const ids = useMemo(() => songs.map((s) => s.id), [songs]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    // `over` is the row the dragged item was dropped on. If null (dropped
    // outside any sortable) or the same as `active` (dropped on itself),
    // there's nothing to do.
    if (!over || active.id === over.id) return;

    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    // Produce the new ordering and hand it to the parent.
    const next = arrayMove(songs, oldIndex, newIndex);
    onReorder(next.map((s) => s.id));
  }

  return (
    <div className="glass-card rounded-xl p-2 sm:p-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {songs.map((song, i) => (
              <SortableTrackRow
                key={song.id}
                song={song}
                index={i + 1}
                currentId={currentId}
                isPlaying={isPlaying}
                onPlay={onPlay}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortableTrackRowProps {
  song: Song;
  index: number;
  currentId?: string;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
}

function SortableTrackRow({
  song,
  index,
  currentId,
  isPlaying,
  onPlay,
}: SortableTrackRowProps) {
  // Pull the current song id from the player store as a fallback when the
  // parent doesn't pass `currentId` explicitly. We also pull `togglePlay`
  // so a click on the *currently-playing* row toggles play/pause locally
  // (the parent only needs to know about *new* song clicks via `onPlay`).
  const storeCurrent = usePlayerStore((s) => s.current);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const activeSongId = currentId ?? storeCurrent?.id;
  const isCurrent = activeSongId === song.id;
  const showPause = isCurrent && isPlaying;

  // useSortable wires this row into the surrounding SortableContext.
  // `attributes` provides role/tabIndex/aria for keyboard + screen reader
  // support; `listeners` provides the pointer/keyboard handlers; the ref
  // callbacks register the row + the drag handle so dnd-kit can measure
  // positions and only start drags from the handle.
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: song.id });

  const handleClick = () => {
    if (isCurrent) {
      // Toggle play/pause locally — no parent involvement needed.
      togglePlay();
    } else {
      // New song: let the parent decide (it will likely call
      // `usePlayerStore.playSong(song)` and set the queue).
      onPlay(song);
    }
  };

  return (
    <li
      ref={setNodeRef}
      // Apply the live transform (during drag) + the spring transition
      // (after drop) so the row slides smoothly into its slot.
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group grid grid-cols-[1.5rem_1.75rem_1fr_auto] items-center gap-3 rounded-md px-2 py-2 transition-colors sm:grid-cols-[1.5rem_1.75rem_1fr_minmax(0,120px)_3rem]",
        isCurrent ? "bg-white/[0.08]" : "hover:bg-white/[0.06]",
        // While dragging, lift the row above its siblings + give it a
        // subtle ring so it reads as "picked up".
        isDragging &&
          "z-10 cursor-grabbing bg-white/[0.12] shadow-xl ring-1 ring-fuchsia-500/40",
      )}
      onDoubleClick={handleClick}
    >
      {/* Drag handle — the *only* drag activator. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Drag to reorder ${song.title}`}
        // Spread the sortable attributes + listeners so this button both
        // announces itself correctly to AT (dnd-kit already sets role,
        // tabIndex, aria-roledescription, aria-describedby) and actually
        // starts a drag. stopPropagation on click so a handle tap never
        // reaches the row's play handlers (the distance constraint already
        // prevents a click from starting a drag, but the click event still
        // fires).
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "grid place-items-center text-muted-foreground/60 transition-colors focus-visible:outline-none focus-visible:text-fuchsia-300",
          isDragging ? "cursor-grabbing text-fuchsia-300" : "cursor-grab hover:text-fuchsia-300",
        )}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      {/* # / play button — mirrors the plain TrackList UX. */}
      <button
        type="button"
        onClick={handleClick}
        aria-label={showPause ? `Pause ${song.title}` : `Play ${song.title}`}
        className="relative grid place-items-center text-sm tabular-nums text-muted-foreground"
      >
        <span className={cn("group-hover:opacity-0", isCurrent && "opacity-0")}>
          {index}
        </span>
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          {showPause ? (
            <Pause className="size-4 text-white" fill="currentColor" aria-hidden />
          ) : (
            <Play className="size-4 text-white" fill="currentColor" aria-hidden />
          )}
        </span>
      </button>

      {/* Cover + title + genre/mood. */}
      <button
        type="button"
        onClick={handleClick}
        className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none"
      >
        <CoverImage
          id={song.id}
          src={song.coverUrl}
          alt={song.title}
          size={40}
          playing={showPause}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium",
              isCurrent ? "text-fuchsia-300" : "text-foreground",
            )}
          >
            {song.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {song.genre} · {song.mood}
          </span>
        </span>
      </button>

      {/* Style column on sm+. */}
      <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
        {song.style}
      </span>

      {/* Duration. */}
      <span className="text-right text-sm tabular-nums text-muted-foreground">
        {fmt(song.durationMs)}
      </span>
    </li>
  );
}

export default SortableTrackList;
