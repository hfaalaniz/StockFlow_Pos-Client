import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const isElectronMode = mode === "electron";
  const outDir = isElectronMode ? "dist-electron" : "dist-web";

  return {
    plugins: [react()],
    // Electron requiere base relativa por file://, web necesita base absoluta.
    base: isElectronMode ? "./" : "/",
    server: {
      port: 5174, // puerto diferente al frontend principal (5173)
    },
    build: {
      outDir,
      assetsDir: "assets",
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    define: {
      // URL por defecto del backend; se puede sobrescribir al buildear para cada sucursal
      __DEFAULT_SERVER_URL__: JSON.stringify(
        process.env.DEFAULT_SERVER_URL || "http://localhost:4000"
      ),
    },
  };
});
