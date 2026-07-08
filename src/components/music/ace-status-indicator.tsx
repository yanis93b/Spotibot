"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Status = "checking" | "online" | "offline";

interface HealthResponse {
  ok: boolean;
  configured: boolean;
  model?: string;
  error?: string;
}

/**
 * Live Ace Music connection status pill. Polls `/api/health/ace` once on mount
 * (and again every 60s) to surface whether the configured API key + endpoint
 * are reachable, so the user knows generation will work before they type.
 *
 * States:
 *  - checking: amber pulsing dot, "Checking…"
 *  - online:   green dot, "Ace Music online"
 *  - offline:  red dot, "Ace Music offline" (title shows the error)
 */
export function AceStatusIndicator() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health/ace", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setStatus("offline");
            setError(`HTTP ${res.status}`);
          }
          return;
        }
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        if (data.ok) {
          setStatus("online");
          setError(null);
        } else {
          setStatus("offline");
          setError(data.error || (data.configured ? "Unreachable" : "API key not set"));
        }
      } catch {
        if (!cancelled) {
          setStatus("offline");
          setError("Network error");
        }
      }
    }

    void check();
    const id = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dotClass =
    status === "online"
      ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
      : status === "offline"
        ? "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7)]"
        : "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)] animate-pulse";

  const label =
    status === "online"
      ? "Ace Music online"
      : status === "offline"
        ? "Ace Music offline"
        : "Checking…";

  return (
    <span
      title={
        status === "offline" && error
          ? `Ace Music API unreachable: ${error}`
          : status === "online"
            ? "Connected to the Ace Music cloud API"
            : "Checking Ace Music API status…"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
        status === "online" && "border-emerald-400/20 text-emerald-200/90",
        status === "offline" && "border-rose-400/20 text-rose-200/90",
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">
        {status === "online" ? "Online" : status === "offline" ? "Offline" : "…"}
      </span>
      <span className="sr-only">, {label}</span>
    </span>
  );
}

export default AceStatusIndicator;
