import { createContext, useContext, useEffect, useState } from "react";
import { AUTH_CHANGED_EVENT, getActiveUserId } from "@/lib/active-user";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  resolved: "light",
});

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Per-user storage so light/dark choice is scoped to the signed-in account; a
// new user defaults to "system" rather than inheriting the last user's choice.
const THEME_KEY_PREFIX = "theme:";
const LEGACY_THEME_KEY = "theme";

function themeKey(userId: string): string {
  return `${THEME_KEY_PREFIX}${userId}`;
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function loadTheme(userId: string): Theme {
  const keyed = localStorage.getItem(themeKey(userId));
  if (isTheme(keyed)) return keyed;
  // One-time migration of a pre-scoping (un-keyed) choice to the current user.
  if (userId !== "guest") {
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (isTheme(legacy)) {
      localStorage.removeItem(LEGACY_THEME_KEY);
      localStorage.setItem(themeKey(userId), legacy);
      return legacy;
    }
  }
  return "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string>(() => getActiveUserId());
  const [theme, setTheme] = useState<Theme>(() => loadTheme(getActiveUserId()));

  const resolved = theme === "system" ? getSystemTheme() : theme;

  // Reload this browser's mode preference for whoever just logged in / out.
  useEffect(() => {
    const onAuthChanged = () => {
      const nextUserId = getActiveUserId();
      setUserId(nextUserId);
      setTheme(loadTheme(nextUserId));
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
    localStorage.setItem(themeKey(userId), theme);
  }, [theme, resolved, userId]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const root = document.documentElement;
      const systemTheme = getSystemTheme();
      root.classList.remove("light", "dark");
      root.classList.add(systemTheme);
      root.style.colorScheme = systemTheme;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
