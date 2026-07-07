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
