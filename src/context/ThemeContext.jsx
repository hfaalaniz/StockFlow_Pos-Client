import { createContext, useContext, useEffect, useState } from "react";
import { getRuntimeConfig, isElectronRuntime, setRuntimeConfig } from "../services/runtime";

export const THEMES = {
  gold: {
    name: "Gold",
    accent: "#e8c547",
    accentRgb: "232,197,71",
    bg: "#0d0f14",
    surface: "#14171f",
  },
  dark: {
    name: "Dark",
    accent: "#6366f1",
    accentRgb: "99,102,241",
    bg: "#09090b",
    surface: "#111113",
  },
  light: {
    name: "Light",
    accent: "#2563eb",
    accentRgb: "37,99,235",
    bg: "#f0f4f8",
    surface: "#ffffff",
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const stored = localStorage.getItem("sf_theme") || "gold";
      return THEMES[stored] ? stored : "gold";
    } catch {
      return "gold";
    }
  });

  // Al montar: cargar tema desde Electron config si está disponible
  useEffect(() => {
    const cargar = async () => {
      if (isElectronRuntime()) {
        try {
          const cfg = await getRuntimeConfig();
          if (cfg.theme) {
            setThemeState(cfg.theme);
          }
        } catch { /* ignorar */ }
      }
    };
    cargar();
  }, []);

  useEffect(() => {
    const safeTheme = THEMES[theme] ? theme : "gold";
    const html = document.documentElement;
    html.setAttribute("data-theme", safeTheme);
    if (document.body) document.body.setAttribute("data-theme", safeTheme);

    // Persistir en localStorage siempre
    try { localStorage.setItem("sf_theme", safeTheme); } catch { /* ignore */ }
    // Fix: también persistir en Electron config para sobrevivir reinicios
    if (isElectronRuntime()) {
      setRuntimeConfig({ theme: safeTheme }).catch(() => {});
    }
  }, [theme]);

  const setTheme = (t) => setThemeState(THEMES[t] ? t : "gold");

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
