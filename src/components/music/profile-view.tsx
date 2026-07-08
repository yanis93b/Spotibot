"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Pencil,
  Loader2,
  Music2,
  ListMusic,
  Play,
  Pause,
  User as UserIcon,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { usePlayerStore } from "@/lib/player-store";
import type { Song } from "@/lib/types";
import { CoverImage } from "./cover-image";

/**
 * Local copies of the public-profile response types. Kept in sync with
 * `src/app/api/profile/[username]/route.ts` — they are frozen by the spec so
 * the duplication is safe.
 */
interface PublicProfileUser {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  image: string | null;
  createdAt: string;
}

interface PublicPlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
}

interface PublicProfileResponse {
  user: PublicProfileUser;
  songs: Song[];
  playlists: PublicPlaylistSummary[];
}

export interface ProfileViewProps {
  /** Username of the profile to display (path param from /u/[username]). */
  username: string;
  /** Whether the viewer is the profile owner — shows the "Edit Profile" button. */
  isOwnProfile?: boolean;
  /** Called after a successful PATCH so the parent can redirect (e.g. on username change). */
  onProfileUpdated?: (updated: PublicProfileUser) => void;
  /** Called when a playlist row is clicked (optional — parent decides navigation). */
  onOpenPlaylist?: (playlistId: string) => void;
}

/** Deterministic hue (0–360) from an arbitrary string. Same scheme as cover-image.tsx. */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Extract up to 2 uppercase initials from a display name. */
function getInitials(name: string | null, username: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (username) return username.slice(0, 2).toUpperCase();
  return "??";
}

/** "Member since Jan 2024" — stable, locale-formatted, no relative time. */
function formatMemberSince(iso: string): string {
  try {
    const d = new Date(iso);
    return `Member since ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
  } catch {
    return "Member";
  }
}

/** "Jan 2024" — compact date for playlist rows. */
function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Public user profile page.
 *
 * Layout:
 *   1. Glass header card — large avatar (image or initials gradient), display
 *      name, @username, bio, "Member since" date, and (when isOwnProfile) an
 *      "Edit Profile" button that opens a dialog.
 *   2. Songs grid — responsive grid of CoverImage + title + genre·mood, with
 *      a hover play overlay wired to the shared player store.
 *   3. Playlists list — gradient-covered rows with name, track count, and
 *      creation date.
 *
 * The component fetches its own data via GET /api/profile/[username] (which is
 * public — no auth required). When the owner edits their profile, the dialog
 * PATCHes /api/profile/me and optimistically updates the local state; the
 * parent can react (e.g. redirect on username change) via onProfileUpdated.
 */
export function ProfileView({
  username,
  isOwnProfile = false,
  onProfileUpdated,
  onOpenPlaylist,
}: ProfileViewProps) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const fetchProfile = useCallback(async (uname: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/profile/${encodeURIComponent(uname.toLowerCase())}`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setProfile(null);
        setError("Profile not found");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PublicProfileResponse = await res.json();
      setProfile(data);
    } catch (e) {
      console.error("profile-view: fetch failed", e);
      setProfile(null);
      setError("Failed to load profile. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile(username);
  }, [username, fetchProfile]);

  const handleUpdated = useCallback(
    (updated: PublicProfileUser) => {
      // Optimistically patch the local state so the UI reflects the change
      // immediately. The parent may additionally redirect (e.g. on a username
      // change) which would remount this component with a new prop.
      setProfile((prev) =>
        prev ? { ...prev, user: updated } : prev,
      );
      onProfileUpdated?.(updated);
    },
    [onProfileUpdated],
  );

  // ─── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return <ProfileSkeleton />;
  }

  // ─── Error / 404 ──────────────────────────────────────────────────────────
  if (error || !profile) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 py-16">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 grid size-20 place-items-center rounded-full bg-white/[0.04] ring-1 ring-white/10">
            <AlertCircle className="size-9 text-muted-foreground" aria-hidden />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            {error === "Profile not found"
              ? "Profile not found"
              : "Something went wrong"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {error === "Profile not found"
              ? `We couldn't find a user named @${username}. Check the spelling and try again.`
              : error ?? "Please try again later."}
          </p>
        </div>
      </div>
    );
  }

  const { user, songs, playlists } = profile;

  return (
    <div className="space-y-10 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* ─── Header card ─────────────────────────────────────────────────── */}
      <ProfileHeader
        user={user}
        isOwnProfile={isOwnProfile}
        onEdit={() => setEditOpen(true)}
      />

      {/* ─── Songs ──────────────────────────────────────────────────────── */}
      <section aria-label={`${user.name ?? user.username ?? "User"}'s tracks`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Music2 className="size-5 text-fuchsia-400" aria-hidden />
            Tracks
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {songs.length}
            </span>
          </h2>
        </div>
        {songs.length === 0 ? (
          <EmptyHint
            icon={<Music2 className="size-6 text-muted-foreground" aria-hidden />}
            title="No tracks yet"
            subtitle={
              isOwnProfile
                ? "Generate your first track and it will appear here."
                : "This user hasn't generated any tracks yet."
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {songs.map((song) => (
              <ProfileSongCard key={song.id} song={song} />
            ))}
          </div>
        )}
      </section>

      {/* ─── Playlists ──────────────────────────────────────────────────── */}
      <section aria-label={`${user.name ?? user.username ?? "User"}'s playlists`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ListMusic className="size-5 text-fuchsia-400" aria-hidden />
            Playlists
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {playlists.length}
            </span>
          </h2>
        </div>
        {playlists.length === 0 ? (
          <EmptyHint
            icon={<ListMusic className="size-6 text-muted-foreground" aria-hidden />}
            title="No playlists yet"
            subtitle={
              isOwnProfile
                ? "Create a playlist from your library to see it here."
                : "This user hasn't created any playlists yet."
            }
          />
        ) : (
          <ul className="space-y-2">
            {playlists.map((p) => (
              <ProfilePlaylistRow
                key={p.id}
                playlist={p}
                onClick={onOpenPlaylist ? () => onOpenPlaylist(p.id) : undefined}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ─── Edit dialog (own profile only) ─────────────────────────────── */}
      {isOwnProfile && (
        <EditProfileDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          currentUser={user}
          onSaved={handleUpdated}
          toast={toast}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Glassmorphism header card with avatar + identity + edit button. */
function ProfileHeader({
  user,
  isOwnProfile,
  onEdit,
}: {
  user: PublicProfileUser;
  isOwnProfile: boolean;
  onEdit: () => void;
}) {
  const hue = hueFromString(user.id);
  const hue2 = (hue + 50) % 360;
  const initials = getInitials(user.name, user.username);
  const displayName = user.name ?? user.username ?? "Anonymous";

  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "glass-card relative overflow-hidden rounded-3xl p-6 sm:p-8",
      )}
    >
      {/* Decorative gradient halo behind the avatar */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full opacity-30 blur-3xl"
        style={{
          background: `radial-gradient(circle, hsl(${hue} 70% 50%), transparent 70%)`,
        }}
      />

      <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-7">
        {/* Avatar */}
        <div
          className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-white/15 sm:size-28"
          style={{
            background:
              user.image != null
                ? undefined
                : `linear-gradient(135deg, hsl(${hue} 70% 50%), hsl(${hue2} 70% 42%))`,
          }}
        >
          {user.image ? (
            <img
              src={user.image}
              alt={displayName}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-2xl font-bold text-white sm:text-3xl">
              {initials}
            </span>
          )}
        </div>

        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1
                className="truncate text-2xl font-bold text-foreground sm:text-3xl"
                title={displayName}
              >
                {displayName}
              </h1>
              {user.username && (
                <p
                  className="mt-1 truncate text-sm text-muted-foreground"
                  title={`@${user.username}`}
                >
                  @{user.username}
                </p>
              )}
            </div>

            {isOwnProfile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="shrink-0 border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.08]"
              >
                <Pencil className="size-3.5" aria-hidden />
                Edit Profile
              </Button>
            )}
          </div>

          {user.bio && (
            <p className="mt-3 max-w-prose whitespace-pre-line text-sm leading-relaxed text-foreground/80">
              {user.bio}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden />
              {formatMemberSince(user.createdAt)}
            </span>
            {!user.username && isOwnProfile && (
              <span className="inline-flex items-center gap-1.5 text-fuchsia-300">
                <UserIcon className="size-3.5" aria-hidden />
                Set a username to share your profile
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  );
}

/** A single song card in the profile's tracks grid. */
function ProfileSongCard({ song }: { song: Song }) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playSong = usePlayerStore((s) => s.playSong);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const isCurrent = current?.id === song.id;
  const showPause = isCurrent && isPlaying;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrent) togglePlay();
    else playSong(song);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="group relative"
    >
      <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl">
        <CoverImage
          id={song.id}
          src={song.coverUrl}
          alt={song.title}
          size={999}
          className="!h-full !w-full rounded-xl"
          playing={showPause}
        />
        <div
          className={cn(
            "absolute inset-0 flex items-end justify-end p-3 transition-opacity",
            isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%)",
          }}
        >
          <button
            type="button"
            onClick={handlePlay}
            aria-label={showPause ? `Pause ${song.title}` : `Play ${song.title}`}
            className="grid size-11 translate-y-1 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40 transition-all hover:scale-110 hover:bg-fuchsia-400 group-hover:translate-y-0"
          >
            {showPause ? (
              <Pause className="size-5" fill="currentColor" aria-hidden />
            ) : (
              <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
            )}
          </button>
        </div>
      </div>
      <p
        className={cn(
          "truncate text-sm font-semibold",
          isCurrent ? "text-fuchsia-300" : "text-foreground",
        )}
        title={song.title}
      >
        {song.title}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {song.genre} · {song.mood}
      </p>
    </motion.div>
  );
}

/** A single playlist row in the profile's playlists list. */
function ProfilePlaylistRow({
  playlist,
  onClick,
}: {
  playlist: PublicPlaylistSummary;
  onClick?: () => void;
}) {
  const hue = hueFromString(playlist.id);
  const hue2 = (hue + 50) % 360;
  const interactive = Boolean(onClick);

  const inner = (
    <>
      <div
        className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-white/10"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 70% 50%), hsl(${hue2} 70% 42%))`,
        }}
      >
        <ListMusic className="size-5 text-white/85" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={playlist.name}
        >
          {playlist.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          Playlist · {playlist.trackCount}{" "}
          {playlist.trackCount === 1 ? "track" : "tracks"}
          {playlist.createdAt && ` · ${formatShortDate(playlist.createdAt)}`}
        </p>
      </div>
    </>
  );

  if (interactive) {
    return (
      <li>
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/50"
        >
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      {inner}
    </li>
  );
}

/** Compact empty-state hint used inside the Songs / Playlists sections. */
function EmptyHint({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-white/[0.04] ring-1 ring-white/10">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** Loading skeleton for the whole profile page. */
function ProfileSkeleton() {
  return (
    <div className="space-y-10 px-4 py-6 sm:px-6 sm:py-8 lg:px-8" aria-busy="true">
      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-7">
          <div className="size-24 shrink-0 animate-pulse rounded-full bg-white/10 sm:size-28" />
          <div className="flex-1 space-y-3">
            <div className="h-7 w-48 animate-pulse rounded bg-white/10" />
            <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
            <div className="h-4 w-72 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-square w-full animate-pulse rounded-xl bg-white/10" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit dialog
// ─────────────────────────────────────────────────────────────────────────────

/** Live client-side validation mirrors the server's zod schema. */
const USERNAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface EditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: PublicProfileUser;
  onSaved: (updated: PublicProfileUser) => void;
  toast: ReturnType<typeof useToast>["toast"];
}

function EditProfileDialog({
  open,
  onOpenChange,
  currentUser,
  onSaved,
  toast,
}: EditDialogProps) {
  const [name, setName] = useState(currentUser.name ?? "");
  const [bio, setBio] = useState(currentUser.bio ?? "");
  const [username, setUsername] = useState(currentUser.username ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sync local form state whenever the dialog opens (in case the user prop
  // changed since the last open).
  useEffect(() => {
    if (open) {
      setName(currentUser.name ?? "");
      setBio(currentUser.bio ?? "");
      setUsername(currentUser.username ?? "");
      setFormError(null);
    }
  }, [open, currentUser]);

  const bioCount = bio.length;
  const bioOver = bioCount > 200;

  // Per-field validation. We surface a single inline error (first failure).
  const validate = useCallback((): string | null => {
    const trimmedName = name.trim();
    if (!trimmedName) return "Name cannot be empty.";
    if (trimmedName.length > 80) return "Name must be at most 80 characters.";

    if (bio.length > 200) return "Bio must be at most 200 characters.";

    if (username) {
      if (username.length < 3 || username.length > 20) {
        return "Username must be 3–20 characters.";
      }
      if (!USERNAME_REGEX.test(username)) {
        return "Username must be lowercase letters, numbers, and single hyphens; cannot start or end with a hyphen.";
      }
    }
    return null;
  }, [name, bio, username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }

    // Build the patch body — only include fields that actually changed so we
    // don't trigger the "no updatable fields" 400 if nothing was edited.
    const body: {
      name?: string;
      bio?: string;
      username?: string;
    } = {};
    const trimmedName = name.trim();
    if (trimmedName !== (currentUser.name ?? "")) body.name = trimmedName;
    if (bio !== (currentUser.bio ?? "")) body.bio = bio;
    const lowerUsername = username.toLowerCase();
    if (lowerUsername !== (currentUser.username ?? "")) {
      body.username = lowerUsername;
    }

    if (Object.keys(body).length === 0) {
      // Nothing changed — just close.
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const message =
          (data as { error?: string } | null)?.error ??
          "Failed to update profile.";
        setFormError(message);
        return;
      }
      const updated = (data as { user: PublicProfileUser }).user;
      toast({
        title: "Profile updated",
        description: body.username
          ? `Your profile is now @${updated.username}`
          : "Your changes have been saved.",
      });
      onSaved(updated);
      onOpenChange(false);
    } catch (e) {
      console.error("profile-view: PATCH failed", e);
      setFormError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#1a1a22] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Edit your profile
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="profile-username" className="text-xs font-medium text-muted-foreground">
              Username
            </Label>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
              >
                @
              </span>
              <Input
                id="profile-username"
                value={username}
                onChange={(e) =>
                  setUsername(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "")
                      .slice(0, 20),
                  )
                }
                maxLength={20}
                placeholder="your-handle"
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                className="border-white/10 bg-black/30 pl-7"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              3–20 lowercase letters, numbers, and hyphens. This is your public
              URL: /u/&lt;username&gt;.
            </p>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="profile-name" className="text-xs font-medium text-muted-foreground">
              Display name
            </Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              maxLength={80}
              placeholder="Your name"
              disabled={saving}
              className="border-white/10 bg-black/30"
            />
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label htmlFor="profile-bio" className="text-xs font-medium text-muted-foreground">
              Bio
            </Label>
            <Textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 200))}
              maxLength={200}
              rows={3}
              placeholder="Tell visitors about yourself and your music."
              disabled={saving}
              className="resize-none border-white/10 bg-black/30"
            />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Max 200 characters.</span>
              <span
                className={cn(
                  "tabular-nums",
                  bioOver ? "text-rose-400" : "text-muted-foreground",
                )}
              >
                {bioCount}/200
              </span>
            </div>
          </div>

          {formError && (
            <p className="text-xs text-rose-400" role="alert">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                className="text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={saving}
              className="bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ProfileView;
