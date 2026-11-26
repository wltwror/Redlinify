import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BgPattern,
  ScrollMode,
  ThemeMode,
} from "@redlinify/shared/browser";
import { fetchPreferences, savePreferences } from "../api/client";

export function useThemePreferences() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [bgPattern, setBgPattern] = useState<BgPattern>(() => {
    try {
      return localStorage.getItem("redlinify-bg-pattern") === "grid"
        ? "grid"
        : "dots";
    } catch {
      return "dots";
    }
  });
  const [scrollMode, setScrollModeState] = useState<ScrollMode>(() => {
    try {
      return localStorage.getItem("redlinify-scroll-mode") === "zoom"
        ? "zoom"
        : "pan";
    } catch {
      return "pan";
    }
  });

  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;
  const bgPatternRef = useRef<BgPattern>(bgPattern);
  bgPatternRef.current = bgPattern;

  const dirtyRef = useRef({
    theme: false,
    bg_pattern: false,
    scroll_mode: false,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchPreferences()
      .then((prefs) => {
        if (cancelled) return;
        if (prefs.theme && !dirtyRef.current.theme) {
          themeRef.current = prefs.theme;
          setTheme(prefs.theme);
        }
        if (prefs.bg_pattern && !dirtyRef.current.bg_pattern) {
          bgPatternRef.current = prefs.bg_pattern;
          setBgPattern(prefs.bg_pattern);
        }
        if (prefs.scroll_mode && !dirtyRef.current.scroll_mode) {
          setScrollModeState(prefs.scroll_mode);
        }
      })
      .catch(() => {
        // Offline / unsupported in tests; localStorage keeps working
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("redlinify-theme", theme);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("redlinify-bg-pattern", bgPattern);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [bgPattern]);

  useEffect(() => {
    try {
      localStorage.setItem("redlinify-scroll-mode", scrollMode);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [scrollMode]);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = themeRef.current === "dark" ? "light" : "dark";
    dirtyRef.current.theme = true;
    themeRef.current = next;
    setTheme(next);
    void savePreferences({ theme: next }).catch(() => {});
  }, []);

  const toggleBgPattern = useCallback(() => {
    const next: BgPattern = bgPatternRef.current === "dots" ? "grid" : "dots";
    dirtyRef.current.bg_pattern = true;
    bgPatternRef.current = next;
    setBgPattern(next);
    void savePreferences({ bg_pattern: next }).catch(() => {});
  }, []);

  const setScrollMode = useCallback((next: ScrollMode) => {
    dirtyRef.current.scroll_mode = true;
    setScrollModeState(next);
    void savePreferences({ scroll_mode: next }).catch(() => {});
  }, []);

  return {
    theme,
    bgPattern,
    scrollMode,
    setScrollMode,
    toggleTheme,
    toggleBgPattern,
  };
}
