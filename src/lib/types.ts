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
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

export interface GenerateRequest {
  prompt: string;
  genre: string;
  mood: string;
  style: string;
  voice?: string;
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

/** Maps a UI style to a concrete TTS voice id used by the synth adapter. */
export const STYLE_TO_VOICE: Record<string, string> = {
  "Male Vocal": "xiaochen",
  "Female Vocal": "tongtong",
  "Instrumental Focus": "kazi",
  Choir: "luodo",
  "Spoken Word": "jam",
};

export type Genre = (typeof GENRES)[number];
export type Mood = (typeof MOODS)[number];
export type Style = (typeof STYLES)[number];
