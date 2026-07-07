"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { EqualizerBars } from "./equalizer-bars";

/**
 * Loading state shown in place of the player while a song is being generated.
 *
 * Visually combines three motion layers to make the multi-second wait feel
 * alive: a pair of concentric spinning gradient rings, a 5-bar equalizer,
 * and a cycling stage label. A shimmering progress bar runs underneath.
 */
const STAGES = [
  "Composing lyrics with the LLM…",
  "Arranging verses & chorus…",
  "Synthesizing audio with Ace Music…",
  "Mastering your track…",
] as const;

export function GenerationLoader() {
  const [stageIndex, setStageIndex] = useState(0);

  // Cycle stage copy every ~2.5s. The generation typically takes 10–20s,
  // so each stage gets ~one full pass on average.
  useEffect(() => {
    const id = setInterval(() => {
      setStageIndex((i) => (i + 1) % STAGES.length);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="glass-card flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
      {/* Concentric spinning gradient rings */}
      <div className="relative grid size-24 place-items-center">
        <span className="music-spin-slow absolute inset-0 rounded-full border-2 border-transparent [background:conic-gradient(from_0deg,transparent,rgba(217,70,239,0.85),transparent_45%,rgba(139,92,246,0.7),transparent_75%)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-[2px]" />
        <span className="music-spin-rev absolute inset-2 rounded-full border-2 border-transparent [background:conic-gradient(from_180deg,transparent,rgba(244,63,94,0.7),transparent_60%,rgba(192,132,252,0.6),transparent)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-[2px]" />
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500 shadow-lg shadow-fuchsia-500/30"
        >
          <Sparkles className="size-5 text-white" />
        </motion.div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300/80">
          Generating
        </p>
        <motion.p
          key={stageIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
          className="min-h-[1.5rem] text-sm font-medium text-foreground/90 sm:text-base"
        >
          {STAGES[stageIndex]}
        </motion.p>
      </div>

      <EqualizerBars active barCount={7} className="h-8" />

      {/* Shimmering faux-progress bar */}
      <div className="relative h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
        <div className="music-shimmer absolute inset-0" />
      </div>

      <p className="text-xs text-muted-foreground">
        This usually takes 10–20 seconds.
      </p>
    </div>
  );
}

export default GenerationLoader;
