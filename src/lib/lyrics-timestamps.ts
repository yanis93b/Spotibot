/**
 * Lyrics timestamp estimation utility.
 *
 * Real synced lyrics (LRC format) carry per-line `[mm:ss.xx]` timestamps from
 * the model. The "Ace Music" TTS pipeline doesn't emit those, so we estimate
 * them by distributing the track's total duration evenly across the singable
 * (non-empty, non-section) lines.
 *
 * Section tags like `[Verse 1]` / `[Chorus]` are surfaced with
 * `isSection: true` so the UI can render them as muted headings instead of
 * karaoke lines, and so they're skipped when finding the active line.
 */

export interface LyricLine {
  /** Trimmed line text. */
  text: string;
  /** Estimated start time in seconds from the beginning of the track. */
  startTime: number;
  /** True for `[Section]` heading lines (e.g. [Verse], [Chorus], [Outro]). */
  isSection: boolean;
}

/** Matches a whole-line section tag such as `[Verse 1]` or `[Chorus]`. */
const SECTION_TAG_RE = /^\[[^\]]+\]$/;

/**
 * Split raw lyrics into timestamped lines.
 *
 * Algorithm:
 *  1. Split on `\n`.
 *  2. Drop blank lines entirely (they're neither rendered nor timed).
 *  3. Classify each remaining line as either a `[Section]` heading or a
 *     singable lyric line.
 *  4. Distribute `durationMs` evenly across ONLY the singable lines. Section
 *     headings adopt the timestamp of the singable line that follows them
 *     (they don't consume time themselves), so the active-line finder never
 *     lands on a heading.
 *
 * @param lyrics     Raw lyrics text (may include `[Verse]`/`[Chorus]` tags).
 * @param durationMs Total track duration in milliseconds.
 * @returns          Ordered array of `LyricLine` with `startTime` in seconds.
 *                   Empty if `lyrics` is blank or no singable lines exist.
 */
export function estimateLineTimestamps(
  lyrics: string,
  durationMs: number,
): LyricLine[] {
  const totalSeconds = Math.max(0, durationMs) / 1000;
  const rawLines = (lyrics ?? "").split("\n");

  // First pass: classify + collect non-blank lines.
  const classified: { text: string; isSection: boolean }[] = [];
  for (const raw of rawLines) {
    const text = raw.trim();
    if (!text) continue; // skip empty lines
    classified.push({ text, isSection: SECTION_TAG_RE.test(text) });
  }

  // Count only singable lines for even time distribution.
  const singableCount = classified.filter((l) => !l.isSection).length;
  if (singableCount === 0) return [];
  const perLine = totalSeconds / singableCount;

  // Second pass: assign timestamps.
  const result: LyricLine[] = [];
  let singableIndex = 0;
  for (const line of classified) {
    if (line.isSection) {
      // Headings adopt the timestamp of the upcoming singable line — they
      // don't advance the singable index, so they consume no time.
      result.push({
        text: line.text,
        startTime: singableIndex * perLine,
        isSection: true,
      });
    } else {
      result.push({
        text: line.text,
        startTime: singableIndex * perLine,
        isSection: false,
      });
      singableIndex += 1;
    }
  }

  return result;
}

/**
 * Find the index of the active (currently-sung) line.
 *
 * The active line is the LAST non-section line whose `startTime` is `<=` the
 * given `currentTime`. Returns `-1` when nothing has started yet (e.g. at
 * time 0 before the first line) or when there are no singable lines.
 *
 * Section lines are never returned as active.
 */
export function findActiveLineIndex(
  lines: LyricLine[],
  currentTime: number,
): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].isSection) continue;
    if (lines[i].startTime <= currentTime) {
      idx = i;
    } else {
      break; // lines are ordered by startTime — stop early
    }
  }
  return idx;
}
