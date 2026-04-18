import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system" | "demon" | "demon-light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark", "demon", "demon-light");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
      return;
    }

    // Demon Dark — "dark + demon" — keep .dark so every existing `dark:` Tailwind
    // utility still resolves, then layer the demon palette + atmospherics on top
    // via the .demon scope. Avoids a per-page rewrite of every dark: variant.
    if (theme === "demon") {
      root.classList.add("dark");
      root.classList.add("demon");
      return;
    }

    // Demon Light — "the breach seen through haunted translucent glass."
    // Self-contained pale token system (no .dark, no .demon). Shares emotional
    // language with Demon Dark via parallel atmospherics scoped to .demon-light.
    // We deliberately do NOT add .light because Tailwind `dark:` utilities should
    // resolve to their default branch and `light:` is not in use; this keeps
    // shadcn components reading from the demon-light token overrides cleanly.
    if (theme === "demon-light") {
      root.classList.add("demon-light");
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
