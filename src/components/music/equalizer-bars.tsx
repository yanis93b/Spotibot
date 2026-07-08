"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface EqualizerBarsProps {
  /** When true, bars animate; when false, they rest flat. */
  active: boolean;
  className?: string;
  /** Number of bars to render (default 5). */
  barCount?: number;
  /** Optional override for the bar fill (Tailwind class string). */
  colorClassName?: string;
}

/**
 * Animated equalizer bars used in the now-playing header, the loader, and
 * the history list "currently playing" indicator.
 *
 * Heights are driven by framer-motion keyframe arrays with a per-bar delay
 * so the motion feels organic. The parent MUST give the component a height
 * (e.g. h-4 / h-6) since bar heights are expressed as percentages.
 */
export function EqualizerBars({
  active,
  className,
  barCount = 5,
  colorClassName,
}: EqualizerBarsProps) {
  const bars = Array.from({ length: barCount });

  return (
    <div
      className={cn("flex items-end gap-[3px]", className)}
      aria-hidden="true"
    >
      {bars.map((_, i) => (
        <motion.span
          key={i}
          className={cn(
            "block w-[3px] origin-bottom rounded-full",
            colorClassName ?? "bg-gradient-to-t from-fuchsia-500 to-rose-300",
          )}
          animate={
            active
              ? { height: ["22%", "100%", "45%", "85%", "30%"] }
              : { height: "20%" }
          }
          transition={
            active
              ? {
                  duration: 0.95,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.12,
                }
              : { duration: 0.3, ease: "easeOut" }
          }
          style={{ height: "20%" }}
        />
      ))}
    </div>
  );
}

export default EqualizerBars;
