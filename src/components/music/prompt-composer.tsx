"use client";

import { useMemo, useState } from "react";
import { Loader2, Shuffle, Sparkles, Wand2 } from "lucide-react";
import { motion } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  GENRES,
  MOODS,
  STYLES,
  STYLE_TO_VOICE,
  type GenerateRequest,
  type Song,
} from "@/lib/types";

const MAX_PROMPT = 500;

/** Curated example prompts used by the "Surprise me" randomizer. */
const SAMPLE_PROMPTS: readonly string[] = [
  "A dreamy lo-fi track about late-night city drives and faded neon signs",
  "An epic orchestral anthem for climbing a snow-capped mountain at dawn",
  "A bouncy pop song about sending a risky text and waiting for the reply",
  "A melancholic jazz ballad sung in a smoky, half-empty lounge",
  "An energetic electronic dance track for a sunrise festival set",
  "A romantic R&B groove about slow-dancing in the kitchen at 2am",
  "A dark hip-hop beat with cinematic strings about chasing ambition",
  "A calm ambient piece for watching rain slide down a windowpane",
  "A folk acoustic campfire song about old friends and long summers",
  "A euphoric rock anthem about finally letting go of yesterday",
];

export interface PromptComposerProps {
  /** Controlled loading flag — disabled button + spinner when true. */
  loading: boolean;
  /**
   * Parent-owned fetch handler. Receives the assembled GenerateRequest and
   * returns the created Song (or throws). Parent is responsible for toasts,
   * state mutation, and error handling.
   */
  onGenerate: (req: GenerateRequest) => Promise<Song>;
}

/**
 * The core input surface: prompt textarea, three single-select chip rows
 * (genre / mood / style), a "Surprise me" randomizer, and a gradient
 * generate button. Form state is internal; only loading + onGenerate are
 * controlled by the parent for clean data flow.
 */
export function PromptComposer({ loading, onGenerate }: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [mood, setMood] = useState<string>(MOODS[0]);
  const [style, setStyle] = useState<string>(STYLES[0]);

  const remaining = MAX_PROMPT - prompt.length;
  const canSubmit = prompt.trim().length > 0 && !loading;

  /** Pick a deterministic-ish random element from a readonly tuple. */
  const pickRandom = <T,>(arr: readonly T[]): T =>
    arr[Math.floor(Math.random() * arr.length)];

  const handleSurprise = () => {
    setPrompt(pickRandom(SAMPLE_PROMPTS));
    setGenre(pickRandom(GENRES));
    setMood(pickRandom(MOODS));
    setStyle(pickRandom(STYLES));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const req: GenerateRequest = {
      prompt: prompt.trim(),
      genre,
      mood,
      style,
      voice: STYLE_TO_VOICE[style],
    };
    // Parent handles success/error toasts + state mutation. We swallow
    // rejection here so the composer doesn't crash on a failed request —
    // the parent is the source of truth for surfacing errors.
    try {
      await onGenerate(req);
    } catch {
      /* handled by parent */
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter submits — a power-user shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      aria-label="Song prompt composer"
      className="glass-card relative overflow-hidden p-5 sm:p-6"
    >
      {/* Decorative top gradient hairline */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/60 to-transparent" />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-rose-500/20 ring-1 ring-white/10">
            <Wand2 className="size-4 text-fuchsia-200" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Create your song
            </h2>
            <p className="text-xs text-muted-foreground">
              Describe a vibe, pick a style, and let Ace Music compose.
            </p>
          </div>
        </div>
      </div>

      {/* Prompt input */}
      <div className="relative">
        <Textarea
          value={prompt}
          onChange={(e) =>
            setPrompt(e.target.value.slice(0, MAX_PROMPT))
          }
          onKeyDown={handleKeyDown}
          placeholder="Describe your song… e.g. 'A dreamy lo-fi track about late-night city drives'"
          aria-label="Song description"
          maxLength={MAX_PROMPT}
          className="min-h-[120px] resize-y rounded-xl border-white/10 bg-black/30 px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus-visible:border-fuchsia-400/40"
        />
        <span
          className={cn(
            "pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums",
            remaining < 40 ? "text-rose-300" : "text-muted-foreground/70",
          )}
          aria-hidden
        >
          {prompt.length}/{MAX_PROMPT}
        </span>
      </div>

      {/* Chip selectors */}
      <div className="mt-4 space-y-3">
        <ChipRow
          label="Genre"
          options={GENRES}
          value={genre}
          onChange={setGenre}
          disabled={loading}
        />
        <ChipRow
          label="Mood"
          options={MOODS}
          value={mood}
          onChange={setMood}
          disabled={loading}
        />
        <ChipRow
          label="Style"
          options={STYLES}
          value={style}
          onChange={setStyle}
          disabled={loading}
        />
      </div>

      {/* Action row */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleSurprise}
          disabled={loading}
          aria-label="Randomize prompt and selections"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-foreground/85 transition-all hover:border-fuchsia-400/30 hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Shuffle className="size-4 text-fuchsia-300" aria-hidden />
          Surprise me
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Generate song"
          className={cn(
            "group relative inline-flex h-11 flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-5 text-sm font-semibold text-white transition-all",
            "bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 shadow-lg shadow-fuchsia-500/25",
            "hover:shadow-xl hover:shadow-fuchsia-500/35 hover:brightness-110",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100",
          )}
        >
          {/* Sheen sweep on hover (idle only) */}
          {!loading && (
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
          )}
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-4" aria-hidden />
              Generate Song
            </>
          )}
        </button>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground/70 sm:text-left">
        Tip: press <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px]">⌘/Ctrl</kbd>
        + <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px]">Enter</kbd> to generate.
      </p>
    </motion.section>
  );
}

/** Internal: a single-select chip row with a label. */
function ChipRow({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  // Memoize id prefix per label so screen-reader associations stay stable.
  const labelId = useMemo(
    () => `chip-row-${label.toLowerCase().replace(/\s+/g, "-")}`,
    [label],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span
        id={labelId}
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80"
      >
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={cn(
                "inline-flex min-h-[2.25rem] items-center rounded-full border px-3 py-1 text-xs font-medium transition-all",
                "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-transparent bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white shadow-md shadow-fuchsia-500/25"
                  : "border-white/10 bg-white/5 text-foreground/75 hover:border-fuchsia-400/30 hover:bg-white/10 hover:text-foreground",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PromptComposer;
