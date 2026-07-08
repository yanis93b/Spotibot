"use client";

/**
 * src/components/music/settings-view.tsx
 *
 * Settings page for SpotiBot. Three sections (all wrapped in dark glass cards):
 *
 *   1. Profile — editable name / username / bio. Saves via PATCH /api/profile/me.
 *      Current values are seeded from GET /api/profile/me on mount.
 *
 *   2. Track visibility — the user's tracks with a per-track Private/Public
 *      Switch. Toggling PATCHes /api/songs/[id] with { isPublic: boolean }.
 *      Tracks are fetched from GET /api/songs.
 *
 *   3. Account — read-only email + member-since date, a Sign out button
 *      (next-auth `signOut`), and a red Delete account button that opens an
 *      AlertDialog confirm. The confirm is a placeholder: it just shows a
 *      toast telling the user to contact support.
 *
 * Implementation notes:
 * - The public `Song` type in `@/lib/types` does NOT yet carry an `isPublic`
 *   field. The discover-trending agent (Task 3-C) added a schema addendum
 *   (`prisma/schema-discover.md`) plus an orchestrator TODO to extend
 *   PATCH /api/songs/[id] to accept `{ isPublic?: boolean }` and to expose the
 *   field via `toPublicSong`. We mirror that future shape locally as
 *   `SettingsSong = Song & { isPublic?: boolean }` and treat `undefined` as
 *   "private" (the schema default) — so the component works today and
 *   continues to work after the orchestrator merges the schema.
 * - The Profile section reads `name` / `username` / `bio` / `createdAt` from
 *   GET /api/profile/me (auth-scoped, returns the current user's full
 *   profile). The Account section's email comes from `useSession()` because
 *   the profile endpoint deliberately omits email from its public response
 *   shape (frozen by spec in `src/app/api/profile/me/route.ts`).
 * - All networking is local to this component (parent doesn't need to wire
 *   anything). Toasts route to the mounted `<Toaster/>` via `useToast`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  AtSign,
  CalendarDays,
  Loader2,
  LogOut,
  Mail,
  Save,
  Settings as SettingsIcon,
  Trash2,
  Eye,
  EyeOff,
  Music2,
} from "lucide-react";
import { useSession, signOut } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Song } from "@/lib/types";
import { CoverImage } from "./cover-image";

// ─────────────────────────────────────────────────────────────────────────────
// Types — local copies, frozen by spec.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public user identity block returned by GET /api/profile/me. Kept in sync with
 * `src/app/api/profile/me/route.ts` (intentionally duplicated — see route file
 * for rationale; shapes are frozen by spec).
 */
interface PublicProfileUser {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  image: string | null;
  createdAt: string; // ISO 8601
}

interface PublicProfileResponse {
  user: PublicProfileUser;
  songs: Song[];
  // playlists aren't used on this screen; keep the field for type fidelity.
  playlists: unknown[];
}

/**
 * Song row as returned by GET /api/songs, extended with the forward-compatible
 * `isPublic` flag. Until the orchestrator merges `prisma/schema-discover.md`
 * + exposes `isPublic` via `toPublicSong`, the field will be `undefined` — we
 * treat that as "private" (matches the schema default `@default(false)`).
 */
type SettingsSong = Song & { isPublic?: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Validation constants (mirror the server's zod schema exactly).
// ─────────────────────────────────────────────────────────────────────────────

const NAME_MIN = 1;
const NAME_MAX = 80;
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const BIO_MAX = 200;
const USERNAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** "Jan 5, 2024" — stable, locale-formatted long date. */
function formatMemberSince(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * Lowercase + strip every char that isn't a lowercase letter / digit / hyphen.
 * Used as the user types into the username field so the displayed value can
 * never drift from what the validator will accept.
 */
function sanitizeUsernameInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/--+/g, "-");
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN) return "Name is required.";
  if (trimmed.length > NAME_MAX) return `Name must be at most ${NAME_MAX} characters.`;
  return null;
}

function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN)
    return `Username must be at least ${USERNAME_MIN} characters.`;
  if (username.length > USERNAME_MAX)
    return `Username must be at most ${USERNAME_MAX} characters.`;
  if (!USERNAME_REGEX.test(username))
    return "Use lowercase letters, numbers, and single hyphens only.";
  return null;
}

function validateBio(bio: string): string | null {
  if (bio.length > BIO_MAX) return `Bio must be at most ${BIO_MAX} characters.`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsView() {
  const { toast } = useToast();
  const { data: session } = useSession();

  // ─── Profile state ────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<PublicProfileUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Editable fields (seeded from `profile` once it loads).
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // ─── Tracks state ────────────────────────────────────────────────────────
  const [songs, setSongs] = useState<SettingsSong[]>([]);
  const [songsLoading, setSongsLoading] = useState(true);
  const [songsError, setSongsError] = useState<string | null>(null);
  /** id of the track whose visibility PATCH is in-flight (disables its Switch). */
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);

  // ─── Fetch profile on mount ──────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/profile/me", { cache: "no-store" });
      if (res.status === 401) {
        setProfileError("You need to be signed in to view settings.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PublicProfileResponse = await res.json();
      setProfile(data.user);
      setName(data.user.name ?? "");
      setUsername(data.user.username ?? "");
      setBio(data.user.bio ?? "");
    } catch (e) {
      console.error("settings-view: profile fetch failed", e);
      setProfileError("Failed to load your profile. Please try again.");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // ─── Fetch tracks on mount ───────────────────────────────────────────────
  const fetchSongs = useCallback(async () => {
    setSongsLoading(true);
    setSongsError(null);
    try {
      const res = await fetch("/api/songs", { cache: "no-store" });
      if (res.status === 401) {
        setSongsError("You need to be signed in to view your tracks.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { songs: SettingsSong[] } = await res.json();
      setSongs(data.songs);
    } catch (e) {
      console.error("settings-view: songs fetch failed", e);
      setSongsError("Failed to load your tracks. Please try again.");
    } finally {
      setSongsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
    void fetchSongs();
  }, [fetchProfile, fetchSongs]);

  // ─── Derived state for the Profile form ───────────────────────────────────
  const nameError = useMemo(() => validateName(name), [name]);
  const usernameError = useMemo(() => validateUsername(username), [username]);
  const bioError = useMemo(() => validateBio(bio), [bio]);

  const isDirty = useMemo(() => {
    if (!profile) return false;
    const nextName = name.trim();
    const nextUsername = username.trim();
    const nextBio = bio.trim();
    return (
      nextName !== (profile.name ?? "") ||
      nextUsername !== (profile.username ?? "") ||
      // Allow clearing the bio by submitting an empty string (server stores "").
      nextBio !== (profile.bio ?? "")
    );
  }, [name, username, bio, profile]);

  const isValid = !nameError && !usernameError && !bioError;
  const canSave = isDirty && isValid && !savingProfile;

  // ─── Save profile handler ─────────────────────────────────────────────────
  const handleSaveProfile = useCallback(async () => {
    if (!profile || !canSave) return;

    // Build the PATCH body — only fields that actually changed.
    const body: { name?: string; username?: string; bio?: string | null } = {};
    const nextName = name.trim();
    const nextUsername = username.trim();
    const nextBio = bio.trim();

    if (nextName !== (profile.name ?? "")) body.name = nextName;
    if (nextUsername !== (profile.username ?? "")) body.username = nextUsername;
    if (nextBio !== (profile.bio ?? "")) {
      // Send empty string when the bio is cleared — the server persists "" and
      // we treat "" as "no bio" everywhere on the client.
      body.bio = nextBio === "" ? null : nextBio;
    }

    if (Object.keys(body).length === 0) return;

    setSavingProfile(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: { user?: PublicProfileUser; error?: string } = await res.json();
      if (!res.ok) {
        const message = data.error ?? "Failed to save profile.";
        toast({
          title: "Couldn't save profile",
          description: message,
          variant: "destructive",
        });
        return;
      }
      if (data.user) {
        setProfile(data.user);
        setName(data.user.name ?? "");
        setUsername(data.user.username ?? "");
        setBio(data.user.bio ?? "");
      }
      toast({
        title: "Profile saved",
        description: "Your changes have been updated.",
      });
    } catch (e) {
      console.error("settings-view: profile save failed", e);
      toast({
        title: "Couldn't save profile",
        description: "Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  }, [profile, canSave, name, username, bio, toast]);

  // ─── Toggle track visibility ─────────────────────────────────────────────
  const handleTogglePublic = useCallback(
    async (songId: string, next: boolean) => {
      // Optimistically update the UI.
      setSongs((prev) =>
        prev.map((s) => (s.id === songId ? { ...s, isPublic: next } : s)),
      );
      setPendingTrackId(songId);
      try {
        const res = await fetch(`/api/songs/${encodeURIComponent(songId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPublic: next }),
        });
        if (!res.ok) {
          let message = "Failed to update track.";
          try {
            const data: { error?: string } = await res.json();
            if (data.error) message = data.error;
          } catch {
            /* ignore JSON parse errors — use the generic message */
          }
          // Roll back.
          setSongs((prev) =>
            prev.map((s) => (s.id === songId ? { ...s, isPublic: !next } : s)),
          );
          toast({
            title: "Visibility update failed",
            description: message,
            variant: "destructive",
          });
          return;
        }
        toast({
          title: next ? "Track is now public" : "Track is now private",
          description: next
            ? "Anyone with the link can discover this track."
            : "Only you can see this track.",
        });
      } catch (e) {
        console.error("settings-view: toggle visibility failed", e);
        setSongs((prev) =>
          prev.map((s) => (s.id === songId ? { ...s, isPublic: !next } : s)),
        );
        toast({
          title: "Visibility update failed",
          description: "Please check your connection and try again.",
          variant: "destructive",
        });
      } finally {
        setPendingTrackId(null);
      }
    },
    [toast],
  );

  // ─── Account actions ─────────────────────────────────────────────────────
  const handleSignOut = useCallback(() => {
    void signOut({ callbackUrl: "/signin" });
  }, []);

  const handleDeleteAccount = useCallback(() => {
    // Placeholder per spec — no destructive action is taken. Just inform the
    // user that account deletion is a support-managed flow.
    toast({
      title: "Contact support to delete your account",
      description:
        "For your safety, account deletion is handled by our support team.",
    });
  }, [toast]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const email = session?.user?.email ?? null;

  return (
    <div className="music-bg min-h-screen w-full text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* ─── Page header ─────────────────────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mb-8 flex items-center gap-3"
        >
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500/90 to-violet-600/90 ring-1 ring-white/10">
            <SettingsIcon className="size-5 text-white" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="gradient-text">Settings</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage your profile, track visibility, and account.
            </p>
          </div>
        </motion.header>

        <div className="space-y-6">
          {/* ─── Section 1: Profile ─────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            aria-label="Profile"
            className="glass-card p-5 sm:p-6"
          >
            <SectionHeader
              title="Profile"
              subtitle="How you appear to others on SpotiBot."
            />

            {profileLoading ? (
              <ProfileFormSkeleton />
            ) : profileError ? (
              <ErrorNotice message={profileError} onRetry={fetchProfile} />
            ) : (
              <form
                className="mt-5 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveProfile();
                }}
              >
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="settings-name" className="text-sm font-medium">
                    Name
                  </Label>
                  <Input
                    id="settings-name"
                    type="text"
                    autoComplete="name"
                    maxLength={NAME_MAX}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your display name"
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "settings-name-error" : undefined}
                  />
                  <FieldFooter
                    error={nameError}
                    counter={`${name.trim().length}/${NAME_MAX}`}
                    errorId="settings-name-error"
                  />
                </div>

                {/* Username */}
                <div className="space-y-2">
                  <Label
                    htmlFor="settings-username"
                    className="text-sm font-medium"
                  >
                    Username
                  </Label>
                  <div className="relative">
                    <AtSign
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="settings-username"
                      type="text"
                      autoComplete="username"
                      maxLength={USERNAME_MAX}
                      value={username}
                      onChange={(e) =>
                        setUsername(sanitizeUsernameInput(e.target.value))
                      }
                      placeholder="your-handle"
                      className="pl-9"
                      aria-invalid={Boolean(usernameError)}
                      aria-describedby={
                        usernameError ? "settings-username-error" : undefined
                      }
                    />
                  </div>
                  <FieldFooter
                    error={usernameError}
                    counter={`${username.length}/${USERNAME_MAX}`}
                    errorId="settings-username-error"
                  />
                </div>

                {/* Bio */}
                <div className="space-y-2">
                  <Label htmlFor="settings-bio" className="text-sm font-medium">
                    Bio
                  </Label>
                  <Textarea
                    id="settings-bio"
                    rows={4}
                    maxLength={BIO_MAX}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell people a little about yourself."
                    aria-invalid={Boolean(bioError)}
                    aria-describedby={bioError ? "settings-bio-error" : undefined}
                  />
                  <FieldFooter
                    error={bioError}
                    counter={`${bio.length}/${BIO_MAX}`}
                    errorId="settings-bio-error"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!isDirty || savingProfile}
                    onClick={() => {
                      if (!profile) return;
                      setName(profile.name ?? "");
                      setUsername(profile.username ?? "");
                      setBio(profile.bio ?? "");
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="submit"
                    disabled={!canSave}
                    className="bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white hover:from-fuchsia-400 hover:to-violet-500"
                  >
                    {savingProfile ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Save className="size-4" aria-hidden />
                    )}
                    Save changes
                  </Button>
                </div>
              </form>
            )}
          </motion.section>

          {/* ─── Section 2: Track visibility ───────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            aria-label="Track visibility"
            className="glass-card p-5 sm:p-6"
          >
            <SectionHeader
              title="Track visibility"
              subtitle="Choose which of your tracks are public on the Discover feed."
            />

            {songsLoading ? (
              <TrackListSkeleton />
            ) : songsError ? (
              <ErrorNotice message={songsError} onRetry={fetchSongs} />
            ) : songs.length === 0 ? (
              <div className="mt-5 grid place-items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-10 text-center">
                <Music2 className="size-7 text-muted-foreground" aria-hidden />
                <p className="mt-3 text-sm font-medium text-foreground">
                  No tracks yet
                </p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Generate your first track and you'll be able to make it public here.
                </p>
              </div>
            ) : (
              <ul
                className="mt-4 max-h-96 overflow-y-auto pr-1"
                role="list"
                aria-label="Your tracks"
              >
                {songs.map((song) => {
                  const isPublic = song.isPublic ?? false;
                  const isPending = pendingTrackId === song.id;
                  return (
                    <li
                      key={song.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.03] sm:gap-4 sm:px-3"
                    >
                      <CoverImage
                        id={song.id}
                        src={song.coverUrl}
                        alt={song.title}
                        size={44}
                        rounded="rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {song.title}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {isPublic ? (
                            <>
                              <Eye className="size-3 text-emerald-400" aria-hidden />
                              <span className="text-emerald-400">Public</span>
                              <span aria-hidden>·</span>
                              <span className="truncate">
                                {song.genre} · {song.mood}
                              </span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="size-3 text-muted-foreground" aria-hidden />
                              <span>Private</span>
                              <span aria-hidden>·</span>
                              <span className="truncate">
                                {song.genre} · {song.mood}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "hidden text-xs font-medium sm:inline",
                            isPublic ? "text-emerald-400" : "text-muted-foreground",
                          )}
                        >
                          {isPublic ? "Public" : "Private"}
                        </span>
                        <Switch
                          checked={isPublic}
                          disabled={isPending}
                          onCheckedChange={(checked) =>
                            void handleTogglePublic(song.id, checked)
                          }
                          aria-label={`Toggle visibility for ${song.title}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.section>

          {/* ─── Section 3: Account ─────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
            aria-label="Account"
            className="glass-card p-5 sm:p-6"
          >
            <SectionHeader
              title="Account"
              subtitle="Your account details and session controls."
            />

            <dl className="mt-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
                    <Mail className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Email
                    </dt>
                    <dd className="mt-0.5 break-all text-sm text-foreground">
                      {profileLoading
                        ? "Loading…"
                        : email ?? "Not available"}
                    </dd>
                  </div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
                    <CalendarDays
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                  </span>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Member since
                    </dt>
                    <dd className="mt-0.5 text-sm text-foreground">
                      {profile ? formatMemberSince(profile.createdAt) : "—"}
                    </dd>
                  </div>
                </div>
              </div>
            </dl>

            <div className="mt-6 flex flex-col gap-3 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={handleSignOut}
                className="border-white/10 bg-white/[0.02] text-foreground hover:bg-white/[0.06]"
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    className="bg-rose-600/90 text-white hover:bg-rose-600"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-[#0d0d14] text-foreground">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle
                        className="size-5 text-rose-400"
                        aria-hidden
                      />
                      Delete account?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This action is permanent. Your tracks, playlists, and
                      profile will be removed. To proceed, please contact our
                      support team.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-white/10 bg-white/[0.02] text-foreground hover:bg-white/[0.06]">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-rose-600 text-white hover:bg-rose-500"
                    >
                      Got it
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components (file-local)
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground sm:text-lg">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
        {subtitle}
      </p>
    </div>
  );
}

function FieldFooter({
  error,
  counter,
  errorId,
}: {
  error: string | null;
  counter: string;
  errorId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p
        id={errorId}
        role={error ? "alert" : undefined}
        className={cn(
          "text-xs",
          error ? "text-rose-400" : "text-transparent",
        )}
      >
        {error ?? "—"}
      </p>
      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
        {counter}
      </span>
    </div>
  );
}

function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-5 flex flex-col items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 shrink-0 text-rose-400" aria-hidden />
        <p className="text-sm text-rose-200">{message}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRetry}
        className="border-white/10 bg-white/[0.02] text-foreground hover:bg-white/[0.06]"
      >
        Try again
      </Button>
    </div>
  );
}

function ProfileFormSkeleton() {
  return (
    <div className="mt-5 space-y-5" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-3.5 w-16 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-9 w-full animate-pulse rounded-md bg-white/[0.06]" />
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <div className="h-9 w-28 animate-pulse rounded-md bg-white/[0.06]" />
      </div>
    </div>
  );
}

/** Stable row-index array for the skeleton (avoids re-allocating per render). */
const TRACK_SKELETON_ROWS = [0, 1, 2, 3] as const;

function TrackListSkeleton() {
  return (
    <ul className="mt-4 space-y-1" aria-busy="true">
      {TRACK_SKELETON_ROWS.map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-lg px-2 py-2.5 sm:gap-4 sm:px-3"
        >
          <div className="size-11 shrink-0 animate-pulse rounded-md bg-white/[0.06]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-white/[0.06]" />
          </div>
          <div className="size-5 animate-pulse rounded-full bg-white/[0.06]" />
        </li>
      ))}
    </ul>
  );
}

export default SettingsView;
