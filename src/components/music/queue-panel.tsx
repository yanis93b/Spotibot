"use client";

import { useMemo, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListMusic, Trash2, X, GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CoverImage } from "./cover-image";
import { useQueueStore } from "@/lib/queue-store";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface QueuePanelProps {
  /** Whether the panel is currently shown. */
  open: boolean;
  /** Hide the panel (called on scrim click / close button). */
  onClose: () => void;
}

/**
 * Spotify-style "Next up" slide-in panel.
 *
 * Renders the list of tracks queued AFTER the currently-playing one (the
 * currently-playing track is shown in the bottom player, so we don't repeat
 * it here). Each row has a drag handle (reorder via @dnd-kit), cover art,
 * title, and a remove button. A "Clear" action in the header empties the
 * queue.
 *
 * The panel itself is controlled (`open`/`onClose`); the parent decides when
 * to mount it. It reads queue state directly from `useQueueStore`.
 */
export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const queue = useQueueStore((s) => s.queue);
  const currentIndex = useQueueStore((s) => s.currentIndex);
  const reorderQueue = useQueueStore((s) => s.reorderQueue);
  const removeFromQueue = useQueueStore((s) => s.removeFromQueue);
  const clearQueue = useQueueStore((s) => s.clearQueue);

  // Require a small drag distance before DnD activates so that a click on a
  // row's drag handle (intended to focus it) doesn't start a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Derive the upcoming list (everything after currentIndex). We attach the
  // absolute queue index to each row so DnD can map back to the store.
  const upcoming = useMemo(() => {
    if (currentIndex < 0) return [] as { song: Song; id: string; absoluteIndex: number }[];
    return queue.slice(currentIndex + 1).map((song, i) => ({
      song,
      // Sortable id = stringified absolute queue index. dnd-kit only needs
      // uniqueness within a single render; after a reorder the indices
      // shift but the drag is already complete, so this is safe.
      id: String(currentIndex + 1 + i),
      absoluteIndex: currentIndex + 1 + i,
    }));
  }, [queue, currentIndex]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    reorderQueue(from, to);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim — click anywhere outside to close. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            aria-hidden
          />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[400px] flex-col border-l border-white/[0.06] bg-[#0a0a0f]/95 backdrop-blur-xl"
            role="dialog"
            aria-label="Play queue"
            aria-modal="true"
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <ListMusic className="size-4 text-fuchsia-200" aria-hidden />
                </span>
                <h2 className="text-sm font-semibold text-foreground">Next up</h2>
                {upcoming.length > 0 && (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {upcoming.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {upcoming.length > 0 && (
                  <button
                    type="button"
                    onClick={clearQueue}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                    title="Clear queue"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close queue"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            {/* ── Body ──────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {upcoming.length === 0 ? (
                <EmptyQueue />
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={upcoming.map((u) => u.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="flex flex-col gap-1">
                      {upcoming.map(({ song, id, absoluteIndex }) => (
                        <SortableQueueItem
                          key={id}
                          id={id}
                          song={song}
                          onRemove={() => removeFromQueue(absoluteIndex)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

interface SortableQueueItemProps {
  /** Unique sortable id (stringified absolute queue index). */
  id: string;
  song: Song;
  onRemove: () => void;
}

/** A single draggable queue row. */
function SortableQueueItem({ id, song, onRemove }: SortableQueueItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  // @dnd-kit applies a CSS transform during drag; we spread it onto the row.
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-lg border border-transparent bg-white/[0.02] p-2 transition-colors hover:border-white/10 hover:bg-white/[0.05]",
        isDragging &&
          "z-10 border-fuchsia-400/30 bg-fuchsia-500/[0.08] shadow-lg shadow-black/40",
      )}
    >
      {/* Drag handle — only this element triggers DnD (so the cover/meta
          click areas remain free for future "jump to this track" actions). */}
      <button
        type="button"
        aria-label="Drag to reorder"
        className="grid size-7 shrink-0 cursor-grab place-items-center text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      <CoverImage
        id={song.id}
        src={song.coverUrl}
        alt={song.title}
        size={40}
        rounded="rounded-md"
      />

      {/* Meta */}
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground/90"
          title={song.title}
        >
          {song.title}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {song.genre} · {song.mood}
        </p>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${song.title} from queue`}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** Empty-state hint shown when there are no upcoming tracks. */
function EmptyQueue() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <ListMusic className="size-8 text-muted-foreground/40" aria-hidden />
      <p className="text-sm text-muted-foreground">Your queue is empty</p>
      <p className="text-xs text-muted-foreground/70">
        Play a song or add tracks to the queue to see them here.
      </p>
    </div>
  );
}

export default QueuePanel;
