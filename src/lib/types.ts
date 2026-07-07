// Shared domain types for the AI music generation platform.
// Consumed by both the API layer (server) and the React UI (client).

export interface Song {
  id: string;
  title: string;
  prompt: string;
  lyrics: string;
  genre: string;
  mood: string;
  style: string;
  voice: string;
  /** Relative URL that streams the generated audio, e.g. "/api/audio/{id}". */
  audioUrl: string;
  /** MIME-ish format identifier, e.g. "mp3". */
  audioFormat: string;
  /** Approximate playback duration in milliseconds (0 if unknown). */
  durationMs: number;
  /** Relative URL that streams the AI cover art, e.g. "/api/cover/{id}". */
  coverUrl: string | null;
  /** Tempo in BPM (null when unset). */
  bpm: number | null;
  /** Musical key, e.g. "C Major" (null when unset). */
  keyScale: string | null;
  /** Time signature, e.g. "4" (null when unset). */
  timeSignature: string | null;
  /** Generation seed (null when random). */
  seed: number | null;
  /** True when the user has liked/favorited this track. */
  liked: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

export interface GenerateRequest {
  prompt: string;
  genre: string;
  mood: string;
  style: string;
  voice?: string;
  /** Track duration in seconds (10–600). Optional; server default applies. */
  duration?: number;
  /** Vocal language code: "en" | "zh" | "ja" | ... Optional, default "en". */
  language?: string;
  /** Enable higher-quality (slower) 5Hz LM planning. Optional, default false. */
  highQuality?: boolean;
  /**
   * Custom mode: when provided, the user wrote their own lyrics and the LLM
   * lyricist is skipped. The Ace Music model renders these lyrics directly.
   */
  customLyrics?: string;
  /** Optional custom title (custom mode). If absent, one is derived. */
  customTitle?: string;
  /** Output audio format. Default "mp3". */
  audioFormat?: string;
  /** Tempo in BPM (30–300). Optional. */
  bpm?: number;
  /** Musical key, e.g. "C Major", "Am". Optional. */
  keyScale?: string;
  /** Time signature "2"|"3"|"4"|"6". Optional. */
  timeSignature?: string;
  /** Specific seed for reproducibility. Optional (random when absent). */
  seed?: number;
}

export interface ApiError {
  error: string;
}

/** Curated option sets exposed by the UI and validated by the API. */
export const GENRES = [
  "Pop",
  "Rock",
  "Hip-Hop",
  "Electronic",
  "R&B",
  "Jazz",
  "Classical",
  "Ambient",
  "Folk",
  "Lo-Fi",
] as const;

export const MOODS = [
  "Energetic",
  "Happy",
  "Romantic",
  "Melancholic",
  "Calm",
  "Dark",
  "Dreamy",
  "Epic",
] as const;

export const STYLES = [
  "Male Vocal",
  "Female Vocal",
  "Instrumental Focus",
  "Choir",
  "Spoken Word",
] as const;

/**
 * Maps a UI style label to a caption fragment that the Ace Music model
 * understands. (The TTS voice-id mapping is no longer used — the model derives
 * the vocal timbre from the caption — but we keep a style→caption-hint map so
 * the selected style still influences the generation.)
 */
export const STYLE_TO_CAPTION: Record<string, string> = {
  "Male Vocal": "male lead vocal",
  "Female Vocal": "female lead vocal",
  "Instrumental Focus": "instrumental, no vocals",
  Choir: "choir vocals",
  "Spoken Word": "spoken-word vocal",
};

/** Supported vocal languages for the Ace Music model. */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "it", label: "Italiano" },
] as const;

/** Output audio formats supported by the Ace Music model. */
export const AUDIO_FORMATS = [
  { code: "mp3", label: "MP3" },
  { code: "wav", label: "WAV" },
  { code: "flac", label: "FLAC" },
  { code: "opus", label: "Opus" },
  { code: "aac", label: "AAC" },
  { code: "wav32", label: "WAV 32-bit" },
] as const;

/** Musical keys the user can pin (empty string = "let the model decide"). */
export const MUSICAL_KEYS = [
  "",
  "C Major",
  "G Major",
  "D Major",
  "A Major",
  "E Major",
  "F Major",
  "Bb Major",
  "Eb Major",
  "A Minor",
  "E Minor",
  "B Minor",
  "F# Minor",
  "C# Minor",
  "G Minor",
  "D Minor",
] as const;

/** Time signatures: "2"=2/4, "3"=3/4, "4"=4/4, "6"=6/8. Empty = auto. */
export const TIME_SIGNATURES = [
  { code: "", label: "Auto" },
  { code: "4", label: "4/4" },
  { code: "3", label: "3/4" },
  { code: "2", label: "2/4" },
  { code: "6", label: "6/8" },
] as const;

/**
 * @deprecated Kept for backwards compatibility. The Ace Music adapter no longer
 * uses TTS voice ids; prefer `STYLE_TO_CAPTION`. New code should not import this.
 */
export const STYLE_TO_VOICE: Record<string, string> = {
  "Male Vocal": "en",
  "Female Vocal": "en",
  "Instrumental Focus": "en",
  Choir: "en",
  "Spoken Word": "en",
};

export type Genre = (typeof GENRES)[number];
export type Mood = (typeof MOODS)[number];
export type Style = (typeof STYLES)[number];
