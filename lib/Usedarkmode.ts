"use client";
import { useEffect, useState, useCallback, RefObject } from "react";

const KEY = "smartrhu_dark";

export function useDarkMode(rootRef: RefObject<HTMLDivElement | null>) {
  const [dark, setDark] = useState(false);

  // Single apply function — toggles BOTH the module root AND <html>
  const applyDark = useCallback(
    (next: boolean) => {
      // 1. CSS Module classes live on this div
      rootRef.current?.classList.toggle("dark", next);
      // 2. Global DarkMode.css uses html.dark
      document.documentElement.classList.toggle("dark", next);
      // 3. Persist
      localStorage.setItem(KEY, String(next));
    },
    [rootRef]
  );

  // On mount: restore saved preference
  useEffect(() => {
    const saved = localStorage.getItem(KEY) === "true";
    setDark(saved);
    applyDark(saved);
  }, [applyDark]);

  // Toggle — uses functional updater so it never reads stale `dark`
  const toggleDark = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      applyDark(next);
      return next;
    });
  }, [applyDark]);

  return { dark, toggleDark };
}