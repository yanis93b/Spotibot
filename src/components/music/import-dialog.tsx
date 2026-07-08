"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, UploadCloud, FileAudio, X } from "lucide-react";
import { GENRES, MOODS, STYLES, type Song } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (song: Song) => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_EXT = ".mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.mp4";

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [mood, setMood] = useState<string>(MOODS[0]);
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [lyrics, setLyrics] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setFile(null);
    setTitle("");
    setGenre(GENRES[0]);
    setMood(MOODS[0]);
    setStyle(STYLES[0]);
    setLyrics("");
    setError(null);
    setDragOver(false);
  };

  const handleFileSelect = (selected: File | null) => {
    if (!selected) return;
    if (selected.size > MAX_FILE_SIZE) {
      setError(`File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
      return;
    }
    setFile(selected);
    setError(null);
    // Auto-fill title from filename if empty.
    if (!title.trim()) {
      const name = selected.name.replace(/\.[^.]+$/, "");
      setTitle(name.slice(0, 80));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Please select an audio file.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      formData.append("genre", genre);
      formData.append("mood", mood);
      formData.append("style", style);
      if (lyrics.trim()) formData.append("lyrics", lyrics.trim());

      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Import failed (${res.status})`);
      }

      const song = (await res.json()) as Song;
      onImported(song);
      resetForm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#1a1a22] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Import Audio
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Upload an existing audio file (MP3, WAV, FLAC, OGG, M4A, AAC) to your library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors",
                dragOver
                  ? "border-fuchsia-400 bg-fuchsia-500/10"
                  : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/[0.03]",
              )}
            >
              <UploadCloud className="size-10 text-muted-foreground/60" aria-hidden />
              <p className="text-sm font-medium text-foreground/80">
                Drag & drop or click to browse
              </p>
              <p className="text-xs text-muted-foreground/60">
                MP3, WAV, FLAC, OGG, M4A, AAC — max 50MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXT}
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-purple-500/20">
                <FileAudio className="size-5 text-fuchsia-200" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || "audio"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label="Remove file"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-rose-300"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}

          {/* Title */}
          <div>
            <label htmlFor="import-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Title
            </label>
            <Input
              id="import-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              placeholder="Track title"
              disabled={loading}
              className="border-white/10 bg-black/30"
            />
          </div>

          {/* Genre / Mood / Style */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Genre</label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                disabled={loading}
                className="h-9 w-full rounded-md border border-white/10 bg-black/30 px-2 text-sm text-foreground focus:border-fuchsia-400/40 focus:outline-none"
              >
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Mood</label>
              <select
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                disabled={loading}
                className="h-9 w-full rounded-md border border-white/10 bg-black/30 px-2 text-sm text-foreground focus:border-fuchsia-400/40 focus:outline-none"
              >
                {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Style</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                disabled={loading}
                className="h-9 w-full rounded-md border border-white/10 bg-black/30 px-2 text-sm text-foreground focus:border-fuchsia-400/40 focus:outline-none"
              >
                {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Lyrics (optional) */}
          <div>
            <label htmlFor="import-lyrics" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Lyrics (optional)
            </label>
            <Textarea
              id="import-lyrics"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value.slice(0, 5000))}
              placeholder="Paste lyrics here…"
              disabled={loading}
              className="min-h-[80px] resize-y border-white/10 bg-black/30 font-mono text-sm"
            />
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !file || !title.trim()}
            className="bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Importing…
              </>
            ) : (
              <>
                <UploadCloud className="mr-2 size-4" aria-hidden />
                Import Track
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportDialog;
