"use client";

import { motion } from "framer-motion";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Heading text. */
  title?: string;
  /** Supporting subtext under the heading. */
  description?: string;
  className?: string;
}

/**
 * Centered placeholder shown in the player area before any song exists.
 * A spinning-soft gradient disc with a music icon, plus heading + subtext.
 */
export function EmptyState({
  title = "Your generated track will appear here",
  description = "Describe a vibe above and hit Generate to compose your first song.",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-5 px-6 py-14 text-center",
        className,
      )}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative grid size-20 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500/25 via-purple-500/20 to-rose-500/25 ring-1 ring-white/10"
      >
        {/* Soft pulsing halo */}
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-fuchsia-500/15"
          animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <Music className="size-9 text-fuchsia-200" />
      </motion.div>

      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-foreground/90">{title}</h3>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

export default EmptyState;
