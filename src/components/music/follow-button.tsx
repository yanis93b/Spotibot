"use client";

/**
 * FollowButton — Spotify-style follow / following / unfollow toggle.
 *
 * Visual states:
 *   - Not following  → "Follow"  (fuchsia gradient pill, prominent)
 *   - Following      → "Following" (subtle dark pill)
 *   - Following + hover → "Unfollow" (rose-tinted pill, signals destructive)
 *
 * Behavior:
 *   - Optimistic UI: the label flips immediately on click; the API call fires
 *     in the background. On failure we roll back + show a toast.
 *   - Idempotent: a follow click when already-following is a no-op (the API
 *     also returns 200 for the already-following case).
 *   - Hides itself when:
 *       * the session is still loading (avoid a flash of the wrong state),
 *       * the user isn't signed in (no point prompting follow with no auth),
 *       * the target user IS the current user (you can't follow yourself).
 *
 * Accessibility:
 *   - `aria-pressed` reflects the optimistic follow state.
 *   - `aria-label` describes the current + hovered action for SR users.
 *   - Focus-visible ring (fuchsia) on every interactive state.
 */

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export interface FollowButtonProps {
  /** The user to follow / unfollow. */
  userId: string;
  /** Initial follow state (e.g. hydrated from a server-side check). */
  initialFollowing?: boolean;
  /** Optional className for layout positioning. */
  className?: string;
}

export function FollowButton({
  userId,
  initialFollowing = false,
  className,
}: FollowButtonProps) {
  const { data: session, status } = useSession();
  const { toast } = useToast();

  const [optimistic, setOptimistic] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Resolve the current user's id from the session (it's embedded in the JWT
  // via the `jwt`/`session` callbacks in src/lib/auth.ts).
  const meId = (session?.user as { id?: string } | undefined)?.id;

  // Hide while the session is still resolving to avoid a flash of "Follow"
  // for a user we may already be following.
  if (status === "loading") return null;
  // Hide for anonymous visitors — following requires auth.
  if (!meId) return null;
  // Hide for self — can't follow yourself.
  if (meId === userId) return null;

  const handleClick = async () => {
    if (pending) return;
    const wasFollowing = optimistic;

    // ── Optimistic flip ──────────────────────────────────────────────────
    setOptimistic(!wasFollowing);
    setPending(true);

    try {
      if (wasFollowing) {
        // ── Unfollow ─────────────────────────────────────────────────────
        const res = await fetch(
          `/api/follow/${encodeURIComponent(userId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "Failed to unfollow.");
        }
      } else {
        // ── Follow ───────────────────────────────────────────────────────
        // 201 = newly created; 200 = already following (idempotent). Both
        // are success — only 4xx/5xx trigger the rollback path.
        const res = await fetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ followingId: userId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "Failed to follow.");
        }
      }
    } catch (err) {
      // ── Rollback the optimistic flip + surface the error ───────────────
      setOptimistic(wasFollowing);
      toast({
        title: "Something went wrong",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  const label = optimistic ? (hovered ? "Unfollow" : "Following") : "Follow";
  const ariaLabel = optimistic
    ? hovered
      ? "Unfollow this user"
      : "You are following this user"
    : "Follow this user";

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={pending}
      aria-pressed={optimistic}
      aria-label={ariaLabel}
      className={cn(
        // Base pill — same height/shape as the rest of the app's small CTAs.
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-60",
        // State-dependent visuals.
        optimistic
          ? hovered
            ? // Following + hover → "Unfollow" (rose-tinted, destructive)
              "border border-rose-400/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
            : // Following (no hover) → subtle dark pill
              "border border-white/10 bg-white/[0.06] text-foreground/80 hover:bg-white/[0.1]"
          : // Not following → fuchsia gradient pill (primary CTA)
            "bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white shadow-sm shadow-fuchsia-500/20 hover:brightness-110",
        className,
      )}
    >
      {pending && (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}

export default FollowButton;
