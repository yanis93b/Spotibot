"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SPOTIBOT_THEME_KEY, type SpotibotTheme } from "@/lib/theme-init";

/**
 * Custom event fired when the theme changes WITHIN this tab. The native
 * `storage` event only fires across other tabs/windows, so we dispatch
 * this so the local useSyncExternalStore subscription re-reads after
 * the user clicks the toggle.
 */
const THEME_CHANGE_EVENT = "spotibot:theme-change";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(THEME_CHANGE_EVENT, handler);
  };
}

function getSnapshot(): SpotibotTheme {
  try {
    const stored = window.localStorage.getItem(SPOTIBOT_THEME_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function getServerSnapshot(): SpotibotTheme {
  // Matches the forced `className="dark"` on <html> in the layout, so
  // SSR markup and the first client paint agree (no hydration mismatch).
  return "dark";
}

function applyTheme(next: SpotibotTheme): void {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (next === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
  try {
    window.localStorage.setItem(SPOTIBOT_THEME_KEY, next);
  } catch {
    // Ignore write failures (private mode, quota, etc.).
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

type ThemeToggleProps = {
  className?: string;
};

/**
 * ThemeToggle
 * Compact icon button that flips between light and dark themes.
 * - Persists the choice to localStorage under "spotibot-theme".
 * - Toggles the `dark` class on <html>.
 * - Shows a Sun icon when the current theme is dark (click → go light),
 *   and a Moon icon when the current theme is light (click → go dark).
 * - Uses useSyncExternalStore so the icon stays in sync across tabs.
 */
export default function ThemeToggle({ className }: ThemeToggleProps) {
  const theme = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Keep the <html> class in sync with the store — this also covers
  // cross-tab updates delivered via the `storage` event. This effect
  // only mutates the DOM (no setState), which is the recommended
  // "synchronize with external system" pattern.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const toggle = useCallback(() => {
    applyTheme(theme === "dark" ? "light" : "dark");
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      className={cn(
        "size-8 rounded-full text-foreground/80 hover:text-foreground",
        className,
      )}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
