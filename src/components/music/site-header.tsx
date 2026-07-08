"use client";

import { Music2, Github, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AceStatusIndicator } from "./ace-status-indicator";

export interface SiteHeaderProps {
  className?: string;
}

/**
 * Sticky, glass-blurred top navigation for AceMusic Studio.
 *
 * Left: a gradient-rounded brand tile (Music2 icon) + the "AceMusic Studio"
 * wordmark rendered with the gradient-text utility.
 * Right: a subtle "Ace Music Model" pill and a decorative GitHub link icon.
 * Mobile: paddings compact; wordmark hidden only at the very smallest widths
 * to keep the header uncluttered, but is kept visible by default.
 */
export function SiteHeader({ className }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0f]/70 backdrop-blur-xl supports-[backdrop-filter]:bg-[#0a0a0f]/60",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <a
          href="/"
          className="group flex items-center gap-2.5 rounded-lg focus-visible:outline-none"
          aria-label="AceMusic Studio home"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500 shadow-lg shadow-fuchsia-500/25 transition-transform group-hover:scale-105">
            <Music2 className="size-5 text-white" aria-hidden />
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="gradient-text text-lg font-bold tracking-tight sm:text-xl">
              AceMusic
            </span>
            <span className="hidden text-lg font-bold tracking-tight text-foreground/80 sm:inline sm:text-xl">
              Studio
            </span>
          </span>
        </a>

        <div className="flex items-center gap-2 sm:gap-3">
          <AceStatusIndicator />

          <a
            href="https://acemusic.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20"
            title="Visit acemusic.ai — the world’s first open-source Music AI platform"
          >
            <Sparkles className="size-3" aria-hidden />
            <span className="hidden sm:inline">Ace Music</span>
            <span className="sm:hidden">Ace</span>
          </a>

          <a
            href="https://github.com/ace-step/ACE-Step-1.5"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View ACE-Step source on GitHub (opens in a new tab)"
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <Github className="size-5" aria-hidden />
          </a>
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
