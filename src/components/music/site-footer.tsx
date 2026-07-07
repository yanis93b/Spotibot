"use client";

import { Heart, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SiteFooterProps {
  className?: string;
}

/**
 * Site footer. Rendered as the last child of the root flex-col wrapper with
 * `mt-auto`, so on short content it pins to the viewport bottom and on long
 * content it is pushed down naturally (per sticky-footer requirement).
 */
export function SiteFooter({ className }: SiteFooterProps) {
  return (
    <footer
      className={cn(
        "mt-auto border-t border-white/10 bg-[#0a0a0f]/80 backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:px-6 sm:text-left">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="grid size-6 place-items-center rounded-md bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500">
            <Music2 className="size-3.5 text-white" aria-hidden />
          </span>
          <span>
            <span className="font-semibold text-foreground/90">AceMusic Studio</span>
            <span className="mx-1.5 text-muted-foreground/50">·</span>
            Powered by the Ace Music model
          </span>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
          <Heart className="size-3 text-fuchsia-400" aria-hidden />
          <span>
            Powered by the open-source{" "}
            <a
              href="https://github.com/ace-step/ACE-Step-1.5"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-fuchsia-400/40 underline-offset-2 transition-colors hover:text-fuchsia-200"
            >
              ACE-Step v1.5
            </a>{" "}
            model · real text-to-music synthesis.
          </span>
        </p>
      </div>
    </footer>
  );
}

export default SiteFooter;
