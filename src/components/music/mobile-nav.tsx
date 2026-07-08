"use client";

import { Home, Search, Library, Plus, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SidebarView } from "./app-sidebar";

export interface MobileNavProps {
  view: SidebarView;
  onViewChange: (v: SidebarView) => void;
  isGenerating: boolean;
}

/**
 * Spotify-style mobile bottom tab bar. Shown only on screens below the sm
 * breakpoint (where the left sidebar is hidden). Four tabs: Home, Search,
 * Library, Liked — plus a floating Create action.
 */
export function MobileNav({ view, onViewChange, isGenerating }: MobileNavProps) {
  const tabs: Array<{
    key: SidebarView;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: "create", label: "Home", icon: <Home className="size-5" aria-hidden /> },
    { key: "library", label: "Search", icon: <Search className="size-5" aria-hidden /> },
    { key: "library", label: "Library", icon: <Library className="size-5" aria-hidden /> },
    { key: "liked", label: "Liked", icon: <Heart className="size-5" aria-hidden /> },
  ];

  // The "Search" and "Library" tabs share the library view; we differentiate
  // them only by which is "active" visually based on view + a small heuristic.
  return (
    <nav
      aria-label="Mobile navigation"
      className="sticky bottom-0 z-30 flex h-14 items-stretch border-t border-white/[0.06] bg-[#050507]/95 backdrop-blur-xl sm:hidden"
    >
      {tabs.map((tab, i) => {
        // Only mark "Library" active when view is library AND search is empty
        // (heuristic: the Search tab is the first library entry).
        const active =
          tab.label === "Home"
            ? view === "create"
            : tab.label === "Liked"
              ? view === "liked"
              : tab.label === "Search"
                ? view === "library"
                : view === "library";
        return (
          <button
            key={`${tab.label}-${i}`}
            type="button"
            onClick={() => onViewChange(tab.key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              active ? "text-white" : "text-muted-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onViewChange("create")}
        disabled={isGenerating}
        aria-label="Create new song"
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-fuchsia-300 transition-colors disabled:opacity-60"
      >
        <Plus className={cn("size-5", isGenerating && "animate-spin")} aria-hidden />
        Create
      </button>
    </nav>
  );
}

export default MobileNav;
