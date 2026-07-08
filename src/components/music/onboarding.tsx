"use client";

/**
 * src/components/music/onboarding.tsx
 *
 * Self-contained multi-step onboarding modal for first-time SpotiBot users.
 *
 * Detects first-time users via `localStorage.getItem("spotibot-onboarded")`
 * being null on mount. If null (and the component is mounted on the client),
 * opens a 3-step shadcn Dialog:
 *
 *   Step 1 — Welcome
 *     SpotiBot logo + "Welcome to SpotiBot!" + a one-line description of what
 *     the app does. "Get started" button → step 2.
 *
 *   Step 2 — Set username
 *     Input for a public username (3–20 chars, lowercase alphanumeric +
 *     single hyphens — same rules as PATCH /api/profile/me). Live preview of
 *     the profile URL `/u/your-username`. "Continue" PATCHes /api/profile/me
 *     with `{ username }`. "Skip" advances without setting a username.
 *     Auth-aware: uses `useSession()` to gate the input. If unauthenticated,
 *     shows a "sign in to claim a username" note and only allows skipping.
 *
 *   Step 3 — Feature tour
 *     Three cards (Generate / Browse / Share) summarising the app's key
 *     features. "Done" button writes the onboarded flag + closes.
 *
 * General:
 *   - shadcn `Dialog` (the built-in X button dismisses + marks onboarded).
 *   - Framer Motion `AnimatePresence` transitions between steps (mode="wait").
 *   - 3 progress dots at the bottom; the current step's dot is fuchsia.
 *     Earlier steps are clickable to navigate back; the current + future
 *     steps are not (must use the buttons to advance).
 *   - Self-contained: takes no props, mounts itself, checks localStorage on
 *     mount. SSR-safe (renders nothing during SSR, opens only after a
 *     client-side useEffect).
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import {
  Compass,
  Loader2,
  Music4,
  Share2,
  Sparkles,
  Wand2,
  AtSign,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage key that records the user has completed onboarding. */
const ONBOARDED_KEY = "spotibot-onboarded";

/** Username validation — mirrors the server's zod schema exactly. */
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The three onboarding steps, in order. */
const STEP_COUNT = 3;
type StepIndex = 0 | 1 | 2;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase + strip every char that isn't a lowercase letter / digit / hyphen,
 * collapsing runs of hyphens. Used as the user types so the displayed value
 * can never drift from what the server's regex will accept. Mirrors the
 * sanitizer in `settings-view.tsx` so onboarding + settings stay consistent.
 */
function sanitizeUsernameInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/--+/g, "-");
}

/** Validate a candidate username against the server's rules. */
function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN) {
    return `Username must be at least ${USERNAME_MIN} characters.`;
  }
  if (username.length > USERNAME_MAX) {
    return `Username must be at most ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_REGEX.test(username)) {
    return "Use lowercase letters, numbers, and single hyphens only.";
  }
  return null;
}

/**
 * Read the onboarded flag from localStorage. Returns `true` only when the
 * stored value is the string `"true"`. Wraps every access in try/catch so
 * private-mode / disabled-storage browsers degrade gracefully (treated as
 * "not onboarded yet").
 */
function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Write the onboarded flag. Wrapped in try/catch for the same reason as
 * `readOnboarded` — a failure to persist (e.g. storage disabled) is logged
 * but never thrown; the in-memory open state is what actually controls the
 * modal in that case.
 */
function writeOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "true");
  } catch (err) {
    console.warn("onboarding: could not persist onboarded flag", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function Onboarding() {
  const { toast } = useToast();
  const { status: sessionStatus } = useSession();

  // `mounted` guards the entire client-only flow against SSR hydration
  // mismatches. The dialog is never open during SSR; it only opens after a
  // post-mount useEffect has confirmed the user isn't onboarded yet.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);

  // Username step state.
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // ─── Open the dialog for first-time users on mount ──────────────────────
  useEffect(() => {
    setMounted(true);
    if (!readOnboarded()) {
      setOpen(true);
    }
  }, []);

  // ─── Mark onboarded + close ─────────────────────────────────────────────
  /**
   * Finalise onboarding: persist the flag and close the dialog. Idempotent —
   * called by the "Done" button and by every close path (X / Esc / backdrop)
   * via `handleOpenChange`. Calling it twice is harmless.
   */
  const complete = useCallback(() => {
    writeOnboarded();
    setOpen(false);
  }, []);

  /**
   * Dialog open-state change handler. Any close (X button, Esc, backdrop
   * click) marks the user as onboarded so the modal never re-appears
   * unexpectedly. Opens are passed through unchanged (we never programmatically
   * re-open after completion, but the handler stays general).
   */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        complete();
      } else {
        setOpen(true);
      }
    },
    [complete],
  );

  // ─── Step navigation ────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    setStep((s) => (s < STEP_COUNT - 1 ? ((s + 1) as StepIndex) : s));
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => (s > 0 ? ((s - 1) as StepIndex) : s));
  }, []);

  const goTo = useCallback((target: StepIndex) => {
    // Only allow navigating to steps at or before the current one — the user
    // must use the primary "Continue" / "Done" buttons to advance. This keeps
    // the progress dots honest (they can never skip ahead).
    setStep((current) => (target <= current ? target : current));
  }, []);

  // ─── Username submission ────────────────────────────────────────────────
  /**
   * PATCH /api/profile/me with the entered username. On 200 → advance to step
   * 3. On 400 (validation / username taken) → surface the server's error
   * inline + a toast. On 401 → toast "sign in" + still advance (skip). On any
   * other error → destructive toast + stay on the step.
   */
  const submitUsername = useCallback(async () => {
    const trimmed = username.trim();
    const localError = validateUsername(trimmed);
    if (localError) {
      setUsernameError(localError);
      return;
    }

    setSaving(true);
    setUsernameError(null);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });

      if (res.ok) {
        toast({
          title: "Username saved",
          description: `Your profile is now at /u/${trimmed}`,
        });
        goNext();
        return;
      }

      // Try to parse a server-provided error message.
      let serverMessage = "Failed to save username.";
      try {
        const body = await res.json();
        if (body?.error) serverMessage = body.error;
      } catch {
        // Non-JSON error body — keep the default message.
      }

      if (res.status === 401) {
        // Not signed in — no point retrying. Treat as a skip.
        toast({
          title: "Sign in to set a username",
          description: "You can claim one later from Settings.",
        });
        goNext();
        return;
      }

      setUsernameError(serverMessage);
      toast({
        variant: "destructive",
        title: "Could not save username",
        description: serverMessage,
      });
    } catch (err) {
      console.error("onboarding: username PATCH failed", err);
      const fallback = "Network error — please try again.";
      setUsernameError(fallback);
      toast({
        variant: "destructive",
        title: "Could not save username",
        description: fallback,
      });
    } finally {
      setSaving(false);
    }
  }, [username, toast, goNext]);

  // ─── Don't render anything during SSR / before mount ───────────────────
  // The dialog content itself is conditionally rendered by `open`, but
  // returning null until mounted avoids any chance of a hydration mismatch
  // (the `open` flag is only ever set true inside a useEffect).
  if (!mounted) {
    return null;
  }

  // Username input is interactive only when we're confident the user is
  // signed in. While the session is loading we show a small inline spinner.
  const isAuthed = sessionStatus === "authenticated";
  const sessionLoading = sessionStatus === "loading";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "border-white/10 bg-[#1a1a22] text-foreground sm:max-w-md",
          // Override the default top-right close button styling so it reads
          // well on the dark surface.
          "[&_[data-slot=dialog-close]]:text-muted-foreground",
          "[&_[data-slot=dialog-close]]:hover:text-foreground",
        )}
      >
        {/* Visually-hidden accessible title/description — Radix requires a
            DialogTitle for screen readers; we keep the visible title inside
            each step's body for layout flexibility. */}
        <DialogTitle className="sr-only">Welcome to SpotiBot</DialogTitle>
        <DialogDescription className="sr-only">
          A quick setup guide for new SpotiBot users.
        </DialogDescription>

        {/* ─── Step body (animated) ────────────────────────────────────── */}
        <div className="relative min-h-[18rem]">
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 && (
              <WelcomeStep key="step-0" onContinue={goNext} />
            )}
            {step === 1 && (
              <UsernameStep
                key="step-1"
                username={username}
                onUsernameChange={(raw) => {
                  setUsername(sanitizeUsernameInput(raw));
                  setUsernameError(null);
                }}
                error={usernameError}
                saving={saving}
                sessionLoading={sessionLoading}
                isAuthed={isAuthed}
                onContinue={submitUsername}
                onSkip={goNext}
                onBack={goBack}
              />
            )}
            {step === 2 && (
              <FeatureTourStep
                key="step-2"
                onDone={complete}
                onBack={goBack}
              />
            )}
          </AnimatePresence>
        </div>

        {/* ─── Progress dots ───────────────────────────────────────────── */}
        <ProgressDots current={step} onNavigate={goTo} />
      </DialogContent>
    </Dialog>
  );
}

export default Onboarding;

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

/** Shared slide animation for each step — keeps the transition snappy. */
const stepMotion = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
} as const;

const stepTransition = { duration: 0.22, ease: "easeOut" as const };

// ─── Step 1 — Welcome ─────────────────────────────────────────────────────

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <motion.div
      {...stepMotion}
      transition={stepTransition}
      className="flex flex-col items-center gap-5 py-2 text-center"
    >
      {/* Logo + glowing halo */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-fuchsia-500/30 blur-2xl"
        />
        <img
          src="/logo.svg"
          alt=""
          aria-hidden
          className="size-20 rounded-2xl ring-1 ring-white/10"
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Welcome to SpotiBot!
        </h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          Generate original songs with AI, create playlists, and discover
          music from other creators.
        </p>
      </div>

      <Button
        type="button"
        size="lg"
        onClick={onContinue}
        className="mt-2 w-full bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110 sm:w-auto"
      >
        <Sparkles className="size-4" aria-hidden />
        Get started
      </Button>
    </motion.div>
  );
}

// ─── Step 2 — Set username ────────────────────────────────────────────────

interface UsernameStepProps {
  username: string;
  onUsernameChange: (raw: string) => void;
  error: string | null;
  saving: boolean;
  sessionLoading: boolean;
  isAuthed: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}

function UsernameStep({
  username,
  onUsernameChange,
  error,
  saving,
  sessionLoading,
  isAuthed,
  onContinue,
  onSkip,
  onBack,
}: UsernameStepProps) {
  // Live URL preview — shows the literal placeholder when the field is empty
  // so the user understands the format before they type.
  const previewSlug = username.trim() || "your-username";
  const localError = validateUsername(username);
  // Disable Continue unless the local validation passes AND we're not
  // currently mid-request.
  const canContinue = isAuthed && !saving && !sessionLoading && localError === null;

  return (
    <motion.div
      {...stepMotion}
      transition={stepTransition}
      className="flex flex-col gap-5 py-2"
    >
      <div className="space-y-1 text-left">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <AtSign className="size-5 text-fuchsia-400" aria-hidden />
          Choose your username
        </h2>
        <p className="text-sm text-muted-foreground">
          This is how other creators will find you on SpotiBot.
        </p>
      </div>

      {sessionLoading ? (
        <div
          className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/30 py-6 text-sm text-muted-foreground"
          aria-busy="true"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking your session…
        </div>
      ) : !isAuthed ? (
        // Not signed in — we can't PATCH /api/profile/me, so explain that and
        // offer only a "skip" path (the primary button becomes a continue
        // that just advances).
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-left text-sm text-amber-200/90"
          role="note"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
          <span>
            Sign in to claim a username. You can always set one later from
            Settings.
          </span>
        </div>
      ) : (
        <div className="space-y-2 text-left">
          <Label
            htmlFor="onboarding-username"
            className="text-xs font-medium text-muted-foreground"
          >
            Username
          </Label>
          <div className="relative">
            <Input
              id="onboarding-username"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              maxLength={USERNAME_MAX}
              onChange={(e) => onUsernameChange(e.target.value)}
              disabled={saving}
              placeholder="your-username"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "onboarding-username-error" : undefined}
              className="border-white/10 bg-black/30 pl-3 font-mono text-sm"
            />
            {saving && (
              <Loader2
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>

          {/* Live profile URL preview */}
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>Your public profile URL:</span>
            <span className="font-mono text-fuchsia-300">
              /u/{previewSlug}
            </span>
          </p>

          {/* Inline error (server or local) */}
          {error && (
            <p
              id="onboarding-username-error"
              role="alert"
              className="flex items-center gap-1.5 text-xs text-rose-400"
            >
              <AlertCircle className="size-3.5" aria-hidden />
              {error}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground/80">
            3–20 lowercase letters, numbers, and hyphens.
          </p>
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={saving}
          className="text-muted-foreground hover:text-foreground"
        >
          Back
        </Button>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSkip}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip
          </Button>

          {isAuthed ? (
            <Button
              type="button"
              size="sm"
              onClick={onContinue}
              disabled={!canContinue}
              className="bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110"
            >
              {saving ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="size-3.5" aria-hidden />
                  Continue
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onSkip}
              className="bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110"
            >
              Continue
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Step 3 — Feature tour ────────────────────────────────────────────────

interface FeatureCard {
  icon: typeof Wand2;
  title: string;
  description: string;
  accent: string; // tailwind text color class for the icon
}

const FEATURES: FeatureCard[] = [
  {
    icon: Wand2,
    title: "Generate",
    description: "Describe a vibe and let Ace Music compose a track.",
    accent: "text-fuchsia-400",
  },
  {
    icon: Compass,
    title: "Browse",
    description: "Discover tracks by genre and mood.",
    accent: "text-emerald-400",
  },
  {
    icon: Share2,
    title: "Share",
    description: "Make tracks public and share them with the world.",
    accent: "text-rose-400",
  },
];

function FeatureTourStep({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      {...stepMotion}
      transition={stepTransition}
      className="flex flex-col gap-5 py-2"
    >
      <div className="space-y-1 text-left">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <Music4 className="size-5 text-fuchsia-400" aria-hidden />
          What you can do
        </h2>
        <p className="text-sm text-muted-foreground">
          Three things to get you started on SpotiBot.
        </p>
      </div>

      <ul className="space-y-3" aria-label="Key features">
        {FEATURES.map(({ icon: Icon, title, description, accent }) => (
          <li
            key={title}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] ring-1 ring-white/10",
                accent,
              )}
            >
              <Icon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-1 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onDone}
          className="bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110"
        >
          <Check className="size-3.5" aria-hidden />
          Done
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Progress dots ─────────────────────────────────────────────────────────

/**
 * Three dots, one per step. The current step's dot is fuchsia + slightly
 * wider; completed steps are a muted foreground; future steps are dimmer.
 * Dots at or before the current step are clickable (navigate back); the
 * current + future dots are not interactive.
 */
function ProgressDots({
  current,
  onNavigate,
}: {
  current: StepIndex;
  onNavigate: (target: StepIndex) => void;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 pt-1"
      role="navigation"
      aria-label="Onboarding progress"
    >
      {Array.from({ length: STEP_COUNT }, (_, i) => {
        const index = i as StepIndex;
        const isCurrent = index === current;
        const isCompleted = index < current;
        const clickable = index < current;

        return (
          <button
            key={index}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onNavigate(index)}
            aria-label={
              isCurrent
                ? `Step ${index + 1} of ${STEP_COUNT} (current)`
                : isCompleted
                  ? `Back to step ${index + 1}`
                  : `Step ${index + 1} of ${STEP_COUNT}`
            }
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              isCurrent
                ? "w-6 bg-fuchsia-500"
                : isCompleted
                  ? "w-1.5 bg-foreground/60 hover:bg-foreground/80"
                  : "w-1.5 bg-white/15",
              clickable
                ? "cursor-pointer"
                : "cursor-default",
            )}
          />
        );
      })}
    </div>
  );
}
