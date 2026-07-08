"use client";

/**
 * src/components/music/share-dialog.tsx
 *
 * Modal dialog for sharing a public track. Surfaces:
 *   - the absolute share URL (readonly input) with a one-click Copy button,
 *   - quick social share targets (Twitter/X, Facebook, WhatsApp) that open
 *     each platform's share intent via window.open,
 *   - an "Embed" textarea pre-filled with an `<iframe>` snippet pointing at
 *     the public /track/[id] page (also copyable).
 *
 * The dialog is fully controlled (`open` / `onOpenChange`) so the parent
 * owns trigger state. All absolute URLs are derived from `window.location`
 * on the client via `useSyncExternalStore` (SSR-safe, no setState-in-effect).
 *
 * Copy/social state lives in `ShareDialogBody`, which is rendered inside
 * Radix's `DialogContent`. Radix unmounts `DialogContent` when the dialog
 * closes, so the body — and its transient "Copied!" state — naturally resets
 * each time the dialog re-opens (no effect-based reset needed).
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  Check,
  Copy,
  Facebook,
  Link2,
  MessageCircle,
  Twitter,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ShareDialogProps {
  /** The track id being shared. */
  trackId: string;
  /** The track title (used in the share text + iframe title). */
  trackTitle: string;
  /** Whether the dialog is open. */
  open: boolean;
  /** Controlled open-state setter. */
  onOpenChange: (open: boolean) => void;
}

/**
 * Reads `window.location.origin` in an SSR-safe way. `useSyncExternalStore`
 * returns "" on the server (3rd arg) and the real origin on the client (2nd
 * arg). The origin never changes during a page session, so the subscribe
 * function is a no-op. This avoids the `setState`-in-effect anti-pattern
 * while still deferring the browser-only read to the client.
 */
function useOrigin(): string {
  return useSyncExternalStore(
    () => () => {},
    () =>
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "",
    () => "",
  );
}

/** Builds an absolute share URL for the track. */
function buildShareUrl(origin: string, trackId: string): string {
  if (!origin) return "";
  return `${origin}/track/${encodeURIComponent(trackId)}`;
}

/** Builds an HTML iframe snippet for embedding the public track page. */
function buildEmbedCode(shareUrl: string, title: string): string {
  if (!shareUrl) return "";
  return `<iframe src="${shareUrl}" width="100%" height="380" frameborder="0" allow="autoplay; encrypted-media" loading="lazy" title="${title.replace(/"/g, "&quot;")}"></iframe>`;
}

/** Build a Twitter/X intent URL with the share text + URL. */
function twitterUrl(shareUrl: string, title: string): string {
  const text = `Check out "${title}" on SpotiBot`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
}

/** Build a Facebook sharer URL. */
function facebookUrl(shareUrl: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
}

/** Build a WhatsApp share URL (wa.me deep link with prefilled text). */
function whatsappUrl(shareUrl: string, title: string): string {
  const text = `Check out "${title}" on SpotiBot: ${shareUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

interface ShareDialogBodyProps {
  trackTitle: string;
  shareUrl: string;
  embedCode: string;
}

/**
 * Inner body of the share dialog. Holds the transient "Copied!" / error
 * state. Rendered inside `DialogContent`, so it remounts each time the
 * dialog opens — which naturally resets the copy-state flags without an
 * effect.
 */
function ShareDialogBody({
  trackTitle,
  shareUrl,
  embedCode,
}: ShareDialogBodyProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  /** Copy arbitrary text to the clipboard, falling back to execCommand. */
  const copyToClipboard = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;
      try {
        if (
          typeof navigator !== "undefined" &&
          navigator.clipboard?.writeText
        ) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // Fall through to the legacy path below.
      }
      // Legacy fallback for non-secure contexts where navigator.clipboard
      // is unavailable (e.g. HTTP origins).
      try {
        if (typeof document === "undefined") return false;
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    },
    [],
  );

  const handleCopyLink = useCallback(async () => {
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setLinkCopied(true);
      setCopyFailed(false);
      // Reset the checkmark after a short delay so the button returns to
      // its default "Copy" label for the next interaction.
      window.setTimeout(() => setLinkCopied(false), 2200);
    } else {
      setCopyFailed(true);
    }
  }, [copyToClipboard, shareUrl]);

  const handleCopyEmbed = useCallback(async () => {
    const ok = await copyToClipboard(embedCode);
    if (ok) {
      setEmbedCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setEmbedCopied(false), 2200);
    } else {
      setCopyFailed(true);
    }
  }, [copyToClipboard, embedCode]);

  /** Open a social share intent in a centered popup window. */
  const openSharePopup = useCallback((url: string) => {
    if (!url || typeof window === "undefined") return;
    const w = 600;
    const h = 600;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    window.open(
      url,
      "share-dialog",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,resizable=yes,scrollbars=yes`,
    );
  }, []);

  const socials = [
    {
      key: "twitter",
      label: "Share on X",
      icon: Twitter,
      url: twitterUrl(shareUrl, trackTitle),
    },
    {
      key: "facebook",
      label: "Share on Facebook",
      icon: Facebook,
      url: facebookUrl(shareUrl),
    },
    {
      key: "whatsapp",
      label: "Share on WhatsApp",
      icon: MessageCircle,
      url: whatsappUrl(shareUrl, trackTitle),
    },
  ] as const;

  return (
    <>
      {/* ── Share link + copy ─────────────────────────────────────── */}
      <div className="space-y-2">
        <label
          htmlFor="share-url"
          className="text-xs font-medium text-muted-foreground"
        >
          Share link
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="share-url"
            value={shareUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="border-white/10 bg-black/30 font-mono text-xs"
            aria-label="Share link"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCopyLink}
            disabled={!shareUrl}
            aria-label="Copy share link"
            className={cn(
              "shrink-0 gap-1.5",
              linkCopied
                ? "bg-emerald-500 text-white hover:bg-emerald-500"
                : "bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110",
            )}
          >
            {linkCopied ? (
              <>
                <Check className="size-3.5" aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden />
                Copy
              </>
            )}
          </Button>
        </div>
        {copyFailed && (
          <p className="text-xs text-rose-400">
            Couldn&apos;t copy automatically — select the text and copy manually.
          </p>
        )}
      </div>

      {/* ── Social share buttons ─────────────────────────────────── */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          Share to
        </span>
        <div className="grid grid-cols-3 gap-2">
          {socials.map(({ key, label, icon: Icon, url }) => (
            <button
              key={key}
              type="button"
              onClick={() => openSharePopup(url)}
              disabled={!url}
              aria-label={label}
              title={label}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-3 text-[11px] font-medium text-muted-foreground transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className="size-4" aria-hidden />
              {label.replace("Share on ", "")}
            </button>
          ))}
        </div>
      </div>

      {/* ── Embed code ───────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="share-embed"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            <Link2 className="size-3.5" aria-hidden />
            Embed
          </label>
          <button
            type="button"
            onClick={handleCopyEmbed}
            disabled={!embedCode}
            aria-label="Copy embed code"
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50",
              embedCopied
                ? "text-emerald-400"
                : "text-fuchsia-300 hover:text-fuchsia-200",
            )}
          >
            {embedCopied ? (
              <>
                <Check className="size-3" aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3" aria-hidden />
                Copy embed
              </>
            )}
          </button>
        </div>
        <Textarea
          id="share-embed"
          value={embedCode}
          readOnly
          rows={4}
          onFocus={(e) => e.currentTarget.select()}
          className="resize-none border-white/10 bg-black/30 font-mono text-[11px] leading-relaxed"
          aria-label="Embed code"
        />
      </div>
    </>
  );
}

export function ShareDialog({
  trackId,
  trackTitle,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const origin = useOrigin();
  const shareUrl = useMemo(
    () => buildShareUrl(origin, trackId),
    [origin, trackId],
  );
  const embedCode = useMemo(
    () => buildEmbedCode(shareUrl, trackTitle),
    [shareUrl, trackTitle],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#1a1a22] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Share track
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Anyone with the link can listen to{" "}
            <span className="font-medium text-foreground">{trackTitle}</span>.
          </DialogDescription>
        </DialogHeader>
        {/*
         * Rendered inside DialogContent, so this subtree (and its transient
         * copy-state) is unmounted when the dialog closes — remounting on
         * each open naturally resets the "Copied!" flags.
         */}
        <ShareDialogBody
          trackTitle={trackTitle}
          shareUrl={shareUrl}
          embedCode={embedCode}
        />
      </DialogContent>
    </Dialog>
  );
}

export default ShareDialog;
