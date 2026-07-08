"use client";

import { useState } from "react";
import { Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CoverImageProps {
  /** Song id (for deterministic gradient fallback). */
  id: string;
  /** Cover URL (/api/cover/{id}) or null when no cover was generated. */
  src: string | null;
  /** Alt text. */
  alt: string;
  /** Pixel size (square). */
  size?: number;
  /** Optional className for the wrapper. */
  className?: string;
  /** Rounded corners (Tailwind). Default "rounded-md". */
  rounded?: string;
  /** Show a small equalizer overlay when playing. */
  playing?: boolean;
}

/** Deterministic hue (0–360) for a song's gradient fallback, derived from id. */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * Reusable cover-art image. Renders the AI-generated PNG when `src` is set;
 * otherwise falls back to a deterministic gradient with a music icon. Handles
 * load errors gracefully (e.g. cover endpoint 404) by switching to the gradient.
 *
 * Used in: track list, carousels, now-playing panel, bottom player.
 */
export function CoverImage({
  id,
  src,
  alt,
  size,
  className,
  rounded = "rounded-md",
  playing,
}: CoverImageProps) {
  const [errored, setErrored] = useState(false);
  const showImage = src && !errored;
  const hue = hueFromId(id);
  const hue2 = (hue + 50) % 360;

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden ring-1 ring-white/10",
        rounded,
        className,
      )}
      style={{
        width: size,
        height: size,
        ...(showImage
          ? undefined
          : {
              background: `linear-gradient(135deg, hsl(${hue} 70% 50%), hsl(${hue2} 70% 42%))`,
            }),
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <Music2
          className="text-white/80"
          style={{ width: (size ?? 48) * 0.4, height: (size ?? 48) * 0.4 }}
          aria-hidden
        />
      )}
      {playing && (
        <span className="absolute inset-0 grid place-items-center bg-black/40">
          <EqualizerMini />
        </span>
      )}
    </span>
  );
}

/** Tiny 3-bar equalizer for the playing overlay on small covers. */
function EqualizerMini() {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-[3px] origin-bottom rounded-full bg-fuchsia-300"
          style={{
            height: "100%",
            animation: `eqbar 0.9s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes eqbar {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </span>
  );
}

export default CoverImage;
