"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { isTauriDesktop } from "@/lib/utils";

interface HotkeyConfig {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: () => void;
  description: string;
}

/**
 * Hook for desktop keyboard shortcuts
 * Only active in Tauri desktop environment
 */
export function useDesktopHotkeys() {
  const router = useRouter();
  const isDesktop = typeof window !== "undefined" && isTauriDesktop();

  const hotkeys: HotkeyConfig[] = [
    {
      key: "p",
      metaKey: true,
      action: () => router.push("/projects"),
      description: "Projects (Cmd+P)",
    },
    {
      key: "k",
      metaKey: true,
      action: () => router.push("/search"),
      description: "Open search",
    },
    {
      key: ",",
      metaKey: true,
      action: () => router.push("/settings"),
      description: "Open settings",
    },
    {
      key: "t",
      metaKey: true,
      action: () => router.push("/tasks"),
      description: "Open tasks",
    },
    {
      key: "r",
      metaKey: true,
      action: () => router.push("/risks"),
      description: "Open risks",
    },
    {
      key: "a",
      metaKey: true,
      shiftKey: true,
      action: () => router.push("/analytics"),
      description: "Open analytics",
    },
    {
      key: "h",
      metaKey: true,
      action: () => router.push("/"),
      description: "Go home (dashboard)",
    },
  ];

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isDesktop) return;

      // Ignore if typing in input/textarea
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      for (const hotkey of hotkeys) {
        const metaPressed = hotkey.metaKey
          ? event.metaKey || event.ctrlKey
          : true;
        const ctrlPressed = hotkey.ctrlKey ? event.ctrlKey : true;
        const shiftPressed = hotkey.shiftKey ? event.shiftKey : true;
        const altPressed = hotkey.altKey ? event.altKey : true;

        if (
          event.key.toLowerCase() === hotkey.key.toLowerCase() &&
          metaPressed &&
          ctrlPressed &&
          shiftPressed &&
          altPressed
        ) {
          event.preventDefault();
          hotkey.action();
          return;
        }
      }
    },
    [isDesktop, hotkeys]
  );

  useEffect(() => {
    if (!isDesktop) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDesktop, handleKeyDown]);

  return {
    isDesktop,
    hotkeys: isDesktop ? hotkeys : [],
  };
}

/**
 * Get human-readable hotkey string
 */
export function formatHotkey(hotkey: HotkeyConfig): string {
  const parts: string[] = [];
  
  if (hotkey.metaKey) {
    parts.push("⌘");
  }
  if (hotkey.ctrlKey) {
    parts.push("Ctrl");
  }
  if (hotkey.altKey) {
    parts.push("⌥");
  }
  if (hotkey.shiftKey) {
    parts.push("⇧");
  }
  
  parts.push(hotkey.key.toUpperCase());
  
  return parts.join("");
}
