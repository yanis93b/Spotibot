"use client";

import { useMemo, useState } from "react";
import { Loader2, Shuffle, Sparkles, Wand2, Clock, Gauge, Languages, FileText, Type, ChevronDown, Music, KeyRound, Hash } from "lucide-react";
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
  AUDIO_FORMATS,
  MUSICAL_KEYS,
  TIME_SIGNATURES,
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
  // Advanced model params (all optional / auto by default).
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [audioFormat, setAudioFormat] = useState<string>("mp3");
  const [bpm, setBpm] = useState<number>(120);
  const [useBpm, setUseBpm] = useState<boolean>(false);
  const [keyScale, setKeyScale] = useState<string>("auto");
  const [timeSignature, setTimeSignature] = useState<string>("auto");
  const [useSeed, setUseSeed] = useState<boolean>(false);
  const [seed, setSeed] = useState<number>(0);

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
      audioFormat,
      ...(useBpm ? { bpm } : {}),
      ...(keyScale && keyScale !== "auto" ? { keyScale } : {}),
      ...(timeSignature && timeSignature !== "auto" ? { timeSignature } : {}),
      ...(useSeed ? { seed } : {}),
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

      {/* Advanced settings (collapsible) — all Ace Music model params */}
      <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
          className="flex w-full items-center justify-between px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            <Music className="size-3.5" aria-hidden /> Advanced — all model parameters
          </span>
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")}
            aria-hidden
          />
        </button>
        {showAdvanced && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="space-y-3 px-3.5 pb-3.5"
          >
            {/* BPM */}
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground/85">
                <Switch checked={useBpm} onCheckedChange={setUseBpm} disabled={loading} aria-label="Enable BPM" />
                Tempo (BPM)
              </label>
              {useBpm && (
                <div className="flex flex-1 items-center gap-2">
                  <Slider
                    value={[bpm]}
                    onValueChange={(v) => setBpm(v[0] ?? 120)}
                    min={30}
                    max={300}
                    step={1}
                    disabled={loading}
                    aria-label="BPM"
                    className="flex-1 [&_[data-slot=slider-range]]:bg-fuchsia-400 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-white"
                  />
                  <span className="w-12 text-right text-xs tabular-nums text-fuchsia-200">{bpm}</span>
                </div>
              )}
            </div>

            {/* Key + Time signature + Format row */}
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <KeyRound className="size-3" aria-hidden /> Key
                </label>
                <Select value={keyScale} onValueChange={setKeyScale} disabled={loading}>
                  <SelectTrigger className="h-9 border-white/10 bg-black/30 text-xs" aria-label="Musical key">
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#15151c]">
                    <SelectItem value="auto" className="text-xs">Auto</SelectItem>
                    {MUSICAL_KEYS.filter((k) => k).map((k) => (
                      <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <Clock className="size-3" aria-hidden /> Time Sig
                </label>
                <Select value={timeSignature} onValueChange={setTimeSignature} disabled={loading}>
                  <SelectTrigger className="h-9 border-white/10 bg-black/30 text-xs" aria-label="Time signature">
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#15151c]">
                    {TIME_SIGNATURES.map((t) => (
                      <SelectItem key={t.code || "auto"} value={t.code || "auto"} className="text-xs">{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <Music className="size-3" aria-hidden /> Format
                </label>
                <Select value={audioFormat} onValueChange={setAudioFormat} disabled={loading}>
                  <SelectTrigger className="h-9 border-white/10 bg-black/30 text-xs" aria-label="Audio format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#15151c]">
                    {AUDIO_FORMATS.map((f) => (
                      <SelectItem key={f.code} value={f.code} className="text-xs">{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Seed */}
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground/85">
                <Switch checked={useSeed} onCheckedChange={setUseSeed} disabled={loading} aria-label="Enable seed" />
                <Hash className="size-3" aria-hidden /> Seed (reproducible)
              </label>
              {useSeed && (
                <input
                  type="number"
                  min={0}
                  max={4294967295}
                  value={seed}
                  onChange={(e) => setSeed(Math.max(0, Math.min(4294967295, Number(e.target.value) || 0)))}
                  disabled={loading}
                  aria-label="Generation seed"
                  className="h-9 w-40 rounded-md border border-white/10 bg-black/30 px-2 text-right text-xs tabular-nums focus:border-fuchsia-400/40 focus:outline-none"
                />
              )}
            </div>
          </motion.div>
        )}
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
