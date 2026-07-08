"use client";

import { ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QueueButtonProps {
  /** Number of upcoming tracks (queue length after the current track). */
  count: number;
  /** Whether the queue panel is currently open. */
  active: boolean;
  /** Toggle the queue panel visibility. */
  onToggle: () => void;
}

/**
 * Compact queue button for the bottom player bar. Renders a ListMusic icon
 * with a small fuchsia badge showing the number of upcoming tracks. The
 * badge is hidden when `count === 0` so the icon stays uncluttered when the
 * queue is empty. The button lights up (fuchsia) when the panel is open.
 *
 * Purely presentational — the parent owns the `active`/`count` state and
 * wires `onToggle` to whatever controls the QueuePanel's visibility.
 */
export function QueueButton({ count, active, onToggle }: QueueButtonProps) {
  const displayCount = count > 99 ? "99+" : String(count);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={
        count > 0
          ? `Open queue (${count} upcoming track${count === 1 ? "" : "s"})`
          : "Open queue"
      }
      aria-pressed={active}
      className={cn(
        "relative grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
        active && "text-fuchsia-300 hover:text-fuchsia-200",
      )}
    >
      <ListMusic className="size-4" aria-hidden />
      {count > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full bg-fuchsia-500 px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-[#050507]"
          aria-hidden
        >
          {displayCount}
        </span>
      )}
    </button>
  );
}

export default QueueButton;
