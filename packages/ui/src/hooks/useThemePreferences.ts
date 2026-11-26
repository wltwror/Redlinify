import { useCallback, useEffect, useState } from "react";

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

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const toggleBgPattern = useCallback(() => {
    setBgPattern((prev) => (prev === "dots" ? "grid" : "dots"));
  }, []);

  return {
    theme,
    bgPattern,
    toggleTheme,
    toggleBgPattern,
  };
}
