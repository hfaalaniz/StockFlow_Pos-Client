import { useTheme, THEMES } from "../context/ThemeContext";

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Object.entries(THEMES).map(([key, val]) => {
        const active = theme === key;
        return (
          <button
            key={key}
            title={val.name}
            onClick={() => setTheme(key)}
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: val.accent,
              border: active ? `2px solid var(--text)` : "2px solid transparent",
              outline: active ? `2px solid ${val.accent}` : "none",
              outlineOffset: 1,
              cursor: "pointer",
              transition: "all 0.15s",
              position: "relative",
              flexShrink: 0,
              padding: 0,
            }}
          >
            {active && (
              <span style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#000", fontSize: 9, fontWeight: 900,
              }}>✓</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
