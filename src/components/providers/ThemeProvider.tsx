"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";

export interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextType>({
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

const THEME_STORAGE_KEY = "aquatrack_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("light");
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("light");

  // Apply theme to document element
  const applyTheme = React.useCallback((targetTheme: Theme) => {
    if (typeof window === "undefined") return;

    let effective: "light" | "dark" = "light";

    if (targetTheme === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      effective = prefersDark ? "dark" : "light";
    } else {
      effective = targetTheme;
    }

    const root = document.documentElement;
    if (effective === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }

    setResolvedTheme(effective);
  }, []);

  // Initialize from localStorage or system on mount
  React.useEffect(() => {
    const saved = (localStorage.getItem(THEME_STORAGE_KEY) as Theme) || "light";
    setThemeState(saved);
    applyTheme(saved);

    // Listen to system changes if in system mode
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentSaved = (localStorage.getItem(THEME_STORAGE_KEY) as Theme) || "light";
      if (currentSaved === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [applyTheme]);

  const setTheme = React.useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // LocalStorage might be restricted
      }
      applyTheme(newTheme);
    },
    [applyTheme]
  );

  const toggleTheme = React.useCallback(() => {
    // Toggles between light and dark
    const nextTheme: Theme = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

