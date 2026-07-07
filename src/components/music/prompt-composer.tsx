"use client";

import { useMemo, useState } from "react";
import { Loader2, Shuffle, Sparkles, Wand2, Clock, Gauge, Languages, FileText, Type } from "lucide-react";
import { motion } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  GENRES,
  MOODS,
  STYLES,
  LANGUAGES,
  type GenerateRequest,
  type Song,
} from "@/lib/types";

const MAX_PROMPT = 500;
const MAX_LYRICS = 2000;

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
  const [mode, setMode] = useState<"simple" | "custom">("simple");
  const [prompt, setPrompt] = useState("");
  const [customLyrics, setCustomLyrics] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [mood, setMood] = useState<string>(MOODS[0]);
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [duration, setDuration] = useState<number>(30);
  const [language, setLanguage] = useState<string>("en");
  const [highQuality, setHighQuality] = useState<boolean>(false);

  const remaining = MAX_PROMPT - prompt.length;
  const lyricsRemaining = MAX_LYRICS - customLyrics.length;
  const canSubmit =
    !loading &&
    prompt.trim().length > 0 &&
    (mode === "simple" || customLyrics.trim().length >= 20);
  // Rough wall-clock estimate for the UI. Ace Music takes ~0.8x duration
  // (standard) or ~1.8x (high-quality LM planning), plus fixed overhead.
  const estimatedSeconds = highQuality
    ? Math.round(duration * 1.8 + 8)
    : Math.round(duration * 0.8 + 6);

  /** Pick a deterministic-ish random element from a readonly tuple. */
  const pickRandom = <T,>(arr: readonly T[]): T =>
    arr[Math.floor(Math.random() * arr.length)];

  const handleSurprise = () => {
    setPrompt(pickRandom(SAMPLE_PROMPTS));
    setGenre(pickRandom(GENRES));
    setMood(pickRandom(MOODS));
    setStyle(pickRandom(STYLES));
    setLanguage(pickRandom(LANGUAGES).code);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const req: GenerateRequest = {
      prompt: prompt.trim(),
      genre,
      mood,
      style,
      duration,
      language,
      highQuality,
      ...(mode === "custom"
        ? { customLyrics: customLyrics.trim(), customTitle: customTitle.trim() || undefined }
        : {}),
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
              {mode === "simple"
                ? "Describe a vibe, pick a style, and let Ace Music compose."
                : "Write your own lyrics — Ace Music will arrange and sing them."}
            </p>
          </div>
        </div>

        {/* Simple / Custom mode toggle (Suno-style) */}
        <div
          role="tablist"
          aria-label="Creation mode"
          className="flex shrink-0 rounded-lg border border-white/10 bg-black/30 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "simple"}
            onClick={() => setMode("simple")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all sm:px-3 sm:text-xs",
              mode === "simple"
                ? "bg-gradient-to-r from-fuchsia-500/80 to-purple-500/80 text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Simple
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "custom"}
            onClick={() => setMode("custom")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all sm:px-3 sm:text-xs",
              mode === "custom"
                ? "bg-gradient-to-r from-fuchsia-500/80 to-purple-500/80 text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Custom
          </button>
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

      {/* Custom mode: title + lyrics editors (Suno "Custom" panel) */}
      {mode === "custom" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-4 space-y-3"
        >
          <div>
            <label
              htmlFor="custom-title"
              className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80"
            >
              <Type className="size-3" aria-hidden /> Title (optional)
            </label>
            <input
              id="custom-title"
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value.slice(0, 80))}
              disabled={loading}
              maxLength={80}
              placeholder="e.g. Neon Dreams"
              className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm placeholder:text-muted-foreground/60 focus-visible:border-fuchsia-400/40"
            />
          </div>
          <div className="relative">
            <label
              htmlFor="custom-lyrics"
              className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80"
            >
              <FileText className="size-3" aria-hidden /> Lyrics
            </label>
            <Textarea
              id="custom-lyrics"
              value={customLyrics}
              onChange={(e) => setCustomLyrics(e.target.value.slice(0, MAX_LYRICS))}
              disabled={loading}
              maxLength={MAX_LYRICS}
              placeholder={"Write your lyrics here…\n[Verse 1]\n...\n[Chorus]\n..."}
              aria-label="Custom lyrics"
              className="min-h-[160px] resize-y rounded-xl border-white/10 bg-black/30 px-4 py-3 font-mono text-sm leading-relaxed placeholder:text-muted-foreground/60 focus-visible:border-fuchsia-400/40"
            />
            <span
              className={cn(
                "pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums",
                lyricsRemaining < 100 ? "text-rose-300" : "text-muted-foreground/70",
              )}
              aria-hidden
            >
              {customLyrics.length}/{MAX_LYRICS}
            </span>
          </div>
          {customLyrics.trim().length > 0 && customLyrics.trim().length < 20 && (
            <p className="text-[11px] text-amber-300/80">
              Lyrics need at least 20 characters.
            </p>
          )}
        </motion.div>
      )}

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

      {/* Advanced controls: duration, language, quality */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Duration slider */}
        <div className="rounded-xl border border-white/10 bg-black/20 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              <Clock className="size-3" aria-hidden /> Duration
            </span>
            <span className="text-xs font-medium tabular-nums text-fuchsia-200">
              {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}
            </span>
          </div>
          <Slider
            value={[duration]}
            onValueChange={(v) => setDuration(v[0] ?? 30)}
            min={10}
            max={180}
            step={5}
            disabled={loading}
            aria-label="Track duration in seconds"
            className="[&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-fuchsia-500 [&_[data-slot=slider-range]]:to-rose-400 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-white"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/60">
            <span>10s</span>
            <span>3:00</span>
          </div>
        </div>

        {/* Language selector */}
        <div className="rounded-xl border border-white/10 bg-black/20 p-3.5">
          <span className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            <Languages className="size-3" aria-hidden /> Vocal Language
          </span>
          <Select value={language} onValueChange={setLanguage} disabled={loading}>
            <SelectTrigger
              aria-label="Vocal language"
              className="w-full border-white/10 bg-black/30 text-sm focus-visible:border-fuchsia-400/40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#15151c]">
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code} className="text-sm focus:bg-fuchsia-500/15">
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* High-quality toggle */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-fuchsia-500/15 ring-1 ring-fuchsia-400/20">
            <Gauge className="size-3.5 text-fuchsia-200" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-medium text-foreground/90">High-Quality Mode</p>
            <p className="text-[11px] text-muted-foreground/70">
              Uses 5Hz LM planning for richer arrangements — slower.
            </p>
          </div>
        </div>
        <Switch
          checked={highQuality}
          onCheckedChange={setHighQuality}
          disabled={loading}
          aria-label="Toggle high-quality generation"
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

      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-muted-foreground/70 sm:justify-start">
        <span>
          Tip: press <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px]">⌘/Ctrl</kbd>
          + <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px]">Enter</kbd> to generate.
        </span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span className="tabular-nums">~{estimatedSeconds}s estimated</span>
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
