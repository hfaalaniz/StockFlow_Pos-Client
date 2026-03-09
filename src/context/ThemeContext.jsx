import { createContext, useContext, useEffect, useState } from "react";

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
  const [theme, setThemeState] = useState(
    () => localStorage.getItem("sf_theme") || "gold"
  );

  // Al montar: cargar tema desde Electron config si está disponible
  useEffect(() => {
    const cargar = async () => {
      if (window.electronAPI?.isElectron) {
        try {
          const cfg = await window.electronAPI.getConfig();
          if (cfg.theme) {
            setThemeState(cfg.theme);
          }
        } catch { /* ignorar */ }
      }
    };
    cargar();
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "gold") {
      html.removeAttribute("data-theme");
    } else {
      html.setAttribute("data-theme", theme);
    }
    // Persistir en localStorage siempre
    localStorage.setItem("sf_theme", theme);
    // Fix: también persistir en Electron config para sobrevivir reinicios
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setConfig({ theme }).catch(() => {});
    }
  }, [theme]);

  const setTheme = (t) => setThemeState(t);

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
