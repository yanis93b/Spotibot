"use client";

import { useEffect } from "react";

export const SPOTIBOT_THEME_KEY = "spotibot-theme";
export type SpotibotTheme = "light" | "dark";

/**
 * ThemeInit
 * Renders nothing. On mount, reads the persisted theme from localStorage
 * (default "dark") and applies the `dark` class on <html> accordingly.
 * Mount this as high as possible (top of <body> or in <head>) so the
 * class is set before the rest of the UI paints, minimizing any flash
 * of the wrong theme.
 */
export default function ThemeInit() {
  useEffect(() => {
    const root = document.documentElement;
    try {
      const stored = window.localStorage.getItem(SPOTIBOT_THEME_KEY);
      const theme: SpotibotTheme = stored === "light" ? "light" : "dark";
      if (theme === "dark") {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    } catch {
      // localStorage may be unavailable (private mode, etc.) — fall back
      // to the existing dark class already set on <html> by the layout.
      root.classList.add("dark");
    }
  }, []);

  return null;
}
