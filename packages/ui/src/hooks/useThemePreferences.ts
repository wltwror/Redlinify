import { useCallback, useEffect, useState } from "react";
import type { NavigationMode } from "../utils/viewportNavigation";

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
  const [navMode, setNavMode] = useState<NavigationMode>(() => {
    try {
      return localStorage.getItem("redlinify-nav-mode") === "mouse"
        ? "mouse"
        : "trackpad";
    } catch {
      return "trackpad";
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
      localStorage.setItem("redlinify-nav-mode", navMode);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [navMode]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const toggleBgPattern = useCallback(() => {
    setBgPattern((prev) => (prev === "dots" ? "grid" : "dots"));
  }, []);

  const toggleNavMode = useCallback(() => {
    setNavMode((prev) => (prev === "trackpad" ? "mouse" : "trackpad"));
  }, []);

  return {
    theme,
    bgPattern,
    navMode,
    toggleTheme,
    toggleBgPattern,
    toggleNavMode,
  };
}
