import { useCallback, useEffect, useState } from "react";
import type { ScrollMode } from "../utils/viewportNavigation";

export function useThemePreferences() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [bgPattern, setBgPattern] = useState<"dots" | "grid">(() => {
    try {
      return localStorage.getItem("redlinify-bg-pattern") === "grid"
        ? "grid"
        : "dots";
    } catch {
      return "dots";
    }
  });
  const [scrollMode, setScrollMode] = useState<ScrollMode>(() => {
    try {
      return localStorage.getItem("redlinify-scroll-mode") === "zoom"
        ? "zoom"
        : "pan";
    } catch {
      return "pan";
    }
  });

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
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const toggleBgPattern = useCallback(() => {
    setBgPattern((prev) => (prev === "dots" ? "grid" : "dots"));
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
