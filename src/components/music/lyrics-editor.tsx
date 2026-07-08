"use client";

/**
 * src/components/music/lyrics-editor.tsx
 *
 * Inline dialog for editing the lyrics of an existing track.
 *
 * Flow:
 *   1. Parent renders <LyricsEditor open={...} onOpenChange={...}
 *        songId={...} initialLyrics={...} onSaved={...} />.
 *   2. On open, the textarea is seeded with `initialLyrics`.
 *   3. Save → PATCH /api/songs/[id]/lyrics with { lyrics }.
 *      - 200 → success toast, call `onSaved(newLyrics)`, close dialog.
 *      - 401 → "You need to be signed in…" toast.
 *      - 404 → "Song not found" toast (also covers foreign ownership).
 *      - 400 → surface the server's validation message.
 *      - 5xx / network → generic error toast.
 *   4. Cancel / ESC / overlay click → close without saving.
 *
 * The character counter mirrors the server's 5000-char cap. The Save button
 * is disabled while submitting or when the buffer exceeds the cap so users
 * get immediate feedback before round-tripping.
 */

import * as React from "react";
import { Loader2, Save } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface LyricsEditorProps {
  songId: string;
  initialLyrics: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new lyrics after a successful save. */
  onSaved?: (newLyrics: string) => void;
}

/** Must match the server-side cap in /api/songs/[id]/lyrics/route.ts. */
const MAX_CHARS = 5000;

export function LyricsEditor({
  songId,
  initialLyrics,
  open,
  onOpenChange,
  onSaved,
}: LyricsEditorProps) {
  const { toast } = useToast();
  const [value, setValue] = React.useState(initialLyrics);
  const [isSaving, setIsSaving] = React.useState(false);

  // Re-seed the textarea from the latest `initialLyrics` every time the
  // dialog opens. This discards any unsaved edits if the user previously
  // cancelled, and picks up external updates (e.g. a fresh fetch).
  React.useEffect(() => {
    if (open) {
      setValue(initialLyrics);
      setIsSaving(false);
    }
  }, [open, initialLyrics]);

  const trimmedLength = value.trim().length;
  const overLimit = value.length > MAX_CHARS;
  const unchanged = value === initialLyrics;
  const canSave = !isSaving && !overLimit && !unchanged;

  async function handleSave() {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/songs/${songId}/lyrics`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lyrics: value }),
      });

      // 200 — success.
      if (res.ok) {
        toast({
          title: "Lyrics updated",
          description: "Your edits have been saved.",
        });
        onSaved?.(value);
        onOpenChange(false);
        return;
      }

      // Anything else: try to read a server-provided message.
      let message = "Something went wrong. Please try again.";
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        /* keep the generic message */
      }

      if (res.status === 401) {
        message = "You need to be signed in to edit lyrics.";
      } else if (res.status === 404) {
        message = "Song not found. It may have been deleted.";
      }

      toast({
        title: "Could not save lyrics",
        description: message,
        variant: "destructive",
      });
    } catch {
      // Network error / request never left the browser.
      toast({
        title: "Could not save lyrics",
        description: "Network error. Please check your connection and retry.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  // Keyboard shortcut: ⌘/Ctrl + Enter saves, Escape closes (Radix handles ESC).
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit lyrics</DialogTitle>
          <DialogDescription>
            Tweak the words below. Use <span className="font-mono">[Verse]</span>
            , <span className="font-mono">[Chorus]</span>, etc. to mark sections.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write your lyrics here…"
            aria-label="Lyrics"
            disabled={isSaving}
            className={cn(
              "min-h-72 max-h-[60vh] resize-y font-mono text-[13px] leading-relaxed",
              overLimit &&
                "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
            )}
          />
          <div
            className={cn(
              "pointer-events-none absolute bottom-2 right-3 rounded-md bg-background/80 px-1.5 py-0.5 text-xs tabular-nums backdrop-blur-sm",
              overLimit
                ? "text-destructive"
                : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {value.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </div>
        </div>

        {overLimit && (
          <p className="text-xs text-destructive" role="alert">
            Lyrics exceed the {MAX_CHARS.toLocaleString()}-character limit by{" "}
            {(value.length - MAX_CHARS).toLocaleString()} characters.
          </p>
        )}
        {trimmedLength === 0 && !overLimit && (
          <p className="text-xs text-muted-foreground">
            Saving empty lyrics will clear the track&apos;s lyric sheet.
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            aria-busy={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save />
                Save changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LyricsEditor;
