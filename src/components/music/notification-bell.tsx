"use client";

/**
 * src/components/music/notification-bell.tsx
 *
 * In-app notification bell, designed to drop into the top bar.
 *
 * - Bell icon button with a red badge showing the unread count (hidden
 * when the count is zero).
 * - On click: a dark glassmorphism dropdown showing the recent
 * notifications (max 30 from the API), each with a type-based icon,
 * title, optional body, and a relative timestamp.
 * -"Mark all as read"button at the bottom of the dropdown.
 * - Empty state:"No notifications".
 * - Polls `/api/notifications` every 60s while the dropdown is open so
 * a long-open dropdown stays fresh.
 * - Closes on outside click + Escape.
 *
 * Self-contained — no props are required. The optional `className` is
 * forwarded to the root wrapper for positioning (e.g. `className="relative"`
 * is set internally so the dropdown can anchor to it).
 */

import { useCallback, useEffect, useRef, useState } from"react";
import { formatDistanceToNow } from"date-fns";
import {
 Bell,
 Check,
 Heart,
 Info,
 Loader2,
 Sparkles,
 UserPlus,
 type LucideIcon,
} from"lucide-react";
import { cn } from"@/lib/utils";

/** Mirrors `NotificationItem` from `src/app/api/notifications/route.ts`.
 * Defined locally (rather than imported from a route file) to avoid
 * pulling server-only code into the client bundle. */
interface NotificationItem {
 id: string;
 type: string;
 title: string;
 body: string | null;
 read: boolean;
 createdAt: string;
}

interface NotificationBellProps {
 /** Forwarded to the root wrapper for positioning (e.g. `mr-2`). */
 className?: string;
}

/** Pick a lucide icon for a notification based on its `type`. */
function iconForType(type: string): LucideIcon {
 switch (type) {
 case"follow":
 return UserPlus;
 case"like":
 return Heart;
 case"generation":
 return Sparkles;
 case"system":
 return Info;
 default:
 return Bell;
 }
}

/** Pick a gradient + text accent for the icon chip based on `type`. */
function accentForType(type: string): string {
 switch (type) {
 case"follow":
 return"bg-gradient-to-br from-fuchsia-500/25 to-fuchsia-500/[0.06] text-fuchsia-200 ring-1 ring-fuchsia-400/20";
 case"like":
 return"bg-gradient-to-br from-rose-500/25 to-rose-500/[0.06] text-rose-200 ring-1 ring-rose-400/20";
 case"generation":
 return"bg-gradient-to-br from-purple-500/25 to-purple-500/[0.06] text-purple-200 ring-1 ring-purple-400/20";
 case"system":
 return"bg-gradient-to-br from-emerald-500/25 to-emerald-500/[0.06] text-emerald-200 ring-1 ring-emerald-400/20";
 default:
 return"bg-gradient-to-br from-white/15 to-white/[0.04] text-white/70 ring-1 ring-white/10";
 }
}

/** Format an ISO timestamp as a short relative-time label ("3 minutes ago"). */
function relativeTime(iso: string): string {
 try {
 return formatDistanceToNow(new Date(iso), { addSuffix: true });
 } catch {
 return"";
 }
}

export function NotificationBell({ className }: NotificationBellProps) {
 const [open, setOpen] = useState(false);
 const [notifications, setNotifications] = useState<NotificationItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [marking, setMarking] = useState(false);
 const wrapperRef = useRef<HTMLDivElement>(null);

 const fetchNotifications = useCallback(async () => {
 try {
 const res = await fetch("/api/notifications", { cache:"no-store"});
 if (!res.ok) return;
 const data = (await res.json()) as { notifications: NotificationItem[] };
 setNotifications(data.notifications ?? []);
 } catch {
 // Network/JSON errors are silent — the bell just shows stale state.
 // The user can still click the bell to retry (open toggles a refetch).
 } finally {
 setLoading(false);
 }
 }, []);

 // Initial fetch on mount — populates the unread badge before the user
 // ever opens the dropdown.
 useEffect(() => {
 fetchNotifications();
 }, [fetchNotifications]);

 // Poll every 60s while the dropdown is open. Stops when closed.
 useEffect(() => {
 if (!open) return;
 const id = window.setInterval(fetchNotifications, 60_000);
 return () => window.clearInterval(id);
 }, [open, fetchNotifications]);

 // Close on outside click + Escape. Only attached while open.
 useEffect(() => {
 if (!open) return;
 const handlePointer = (e: MouseEvent) => {
 if (
 wrapperRef.current &&
 !wrapperRef.current.contains(e.target as Node)
 ) {
 setOpen(false);
 }
 };
 const handleKey = (e: KeyboardEvent) => {
 if (e.key ==="Escape") setOpen(false);
 };
 document.addEventListener("mousedown", handlePointer);
 document.addEventListener("keydown", handleKey);
 return () => {
 document.removeEventListener("mousedown", handlePointer);
 document.removeEventListener("keydown", handleKey);
 };
 }, [open]);

 const unreadCount = notifications.reduce(
 (n, item) => (item.read ? n : n + 1),
 0,
 );

 const handleMarkAllRead = useCallback(async () => {
 if (marking || unreadCount === 0) return;
 setMarking(true);
 try {
 const res = await fetch("/api/notifications", {
 method:"POST",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({ readAll: true }),
 });
 if (!res.ok) return;
 // Optimistically reflect the server-side update locally so the badge
 // disappears immediately, without waiting for the next refetch.
 setNotifications((prev) =>
 prev.map((item) => ({ ...item, read: true })),
 );
 } catch {
 // Silent — the user can retry on the next click.
 } finally {
 setMarking(false);
 }
 }, [marking, unreadCount]);

 return (
 <div ref={wrapperRef} className={cn("relative", className)}>
 {/* Bell trigger */}
 <button
 type="button"
 aria-label={
 unreadCount > 0
 ? `Notifications (${unreadCount} unread)`
 :"Notifications"
 }
 aria-haspopup="menu"
 aria-expanded={open}
 onClick={() => setOpen((v) => !v)}
 className={cn(
"relative grid size-8 place-items-center rounded-full transition-colors",
"bg-black/60 text-white/80 hover:bg-black/80 hover:text-white",
"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60",
 open &&"bg-black/80 text-white",
 )}
 >
 <Bell className="size-4"aria-hidden />
 {unreadCount > 0 && (
 <span
 aria-hidden
 className={cn(
"absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full",
"bg-gradient-to-br from-rose-500 to-red-600 px-1 text-[10px] font-bold leading-4 text-white",
"ring-2 ring-black/80 shadow-md shadow-rose-500/40",
 )}
 >
 {unreadCount > 99 ?"99+": unreadCount}
 </span>
 )}
 </button>

 {/* Dropdown panel */}
 {open && (
 <div
 role="menu"
 aria-label="Notifications"
 className={cn(
"absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right",
"rounded-2xl border border-white/[0.08] bg-black/80 p-0 text-white shadow-2xl shadow-black/60",
"backdrop-blur-xl backdrop-saturate-150",
"animate-in fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0",
 )}
 >
 {/* Header */}
 <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
 <h2 className="text-sm font-semibold tracking-tight">
 Notifications
 </h2>
 <button
 type="button"
 onClick={handleMarkAllRead}
 disabled={marking || unreadCount === 0}
 className={cn(
"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
"text-white/70 hover:bg-white/[0.08] hover:text-white",
"disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
 )}
 >
 {marking ? (
 <Loader2 className="size-3.5 animate-spin"aria-hidden />
 ) : (
 <Check className="size-3.5"aria-hidden />
 )}
 Mark all as read
 </button>
 </div>

 {/* Body — list / empty / loading */}
 <div
 className={cn(
"max-h-96 overflow-y-auto",
 // Custom scrollbar styling for the dark theme.
"",
"",
 )}
 >
 {loading ? (
 <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-white/50">
 <Loader2 className="size-4 animate-spin"aria-hidden />
 Loading…
 </div>
 ) : notifications.length === 0 ? (
 <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
 <div className="grid size-10 place-items-center rounded-full bg-white/[0.06] text-white/40">
 <Bell className="size-5"aria-hidden />
 </div>
 <p className="text-sm text-white/60">No notifications</p>
 <p className="text-xs text-white/35">
 You&apos;ll see new followers, likes, and generation updates
 here.
 </p>
 </div>
 ) : (
 <ul role="none"className="divide-y divide-white/[0.04]">
 {notifications.map((item) => {
 const Icon = iconForType(item.type);
 return (
 <li
 key={item.id}
 role="none"
 className={cn(
"relative flex gap-3 px-4 py-3 transition-colors",
 !item.read &&"bg-white/[0.025]",
 )}
 >
 {/* Unread accent bar on the left */}
 {!item.read && (
 <span
 aria-hidden
 className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-fuchsia-400 to-rose-500"
 />
 )}
 {/* Icon chip */}
 <div
 className={cn(
"grid size-9 shrink-0 place-items-center rounded-full",
 accentForType(item.type),
 )}
 >
 <Icon className="size-4"aria-hidden />
 </div>
 {/* Content */}
 <div className="min-w-0 flex-1">
 <p
 className={cn(
"text-sm leading-snug",
 item.read
 ?"text-white/70"
 :"font-medium text-white",
 )}
 >
 {item.title}
 </p>
 {item.body && (
 <p className="mt-0.5 line-clamp-2 text-xs text-white/55">
 {item.body}
 </p>
 )}
 <p className="mt-1 text-[11px] tabular-nums text-white/40">
 {relativeTime(item.createdAt)}
 </p>
 </div>
 </li>
 );
 })}
 </ul>
 )}
 </div>
 </div>
 )}
 </div>
 );
}

export default NotificationBell;
