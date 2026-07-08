"use client";

import { motion } from "framer-motion";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRadio } from "@/hooks/use-radio";

export interface RadioToggleProps {
  className?: string;
}

/**
 * RadioToggle
 * Compact icon button that flips the autoplay / radio feature on and off.
 *
 * - Disabled → muted icon (matches the rest of the bottom-player transport).
 * - Enabled  → fuchsia tint + a subtle opacity pulse to evoke a broadcast
 *   signal, mirroring the fuchsia accent used elsewhere in the app.
 *
 * aria-label="Toggle autoplay", aria-pressed reflects the current state.
 * Uses the `useRadio` hook; this component is purely presentational on top
 * of it.
 */
export function RadioToggle({ className }: RadioToggleProps) {
  const { radioEnabled, toggleRadio } = useRadio();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle autoplay"
      aria-pressed={radioEnabled}
      title={radioEnabled ? "Autoplay on" : "Autoplay off"}
      onClick={toggleRadio}
      className={cn(
        "size-8 rounded-full transition-colors",
        radioEnabled
          ? "text-fuchsia-300 hover:bg-fuchsia-500/10 hover:text-fuchsia-200"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {radioEnabled ? (
        <motion.span
          key="radio-on"
          initial={{ opacity: 0.6 }}
          animate={{ opacity: [1, 0.45, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="grid place-items-center"
          aria-hidden
        >
          <Radio className="size-4" />
        </motion.span>
      ) : (
        <Radio className="size-4" aria-hidden />
      )}
    </Button>
  );
}

export default RadioToggle;
