/**
 * Launcher de Electron para StockFlow POS.
 * Usa el subdirectorio "app/" como entry point para evitar conflicto
 * con node_modules/electron del directorio raíz.
 */

const { spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

console.log('Ejecutando:', path.join(appDir, 'main.js'));
const posClient = 'C:\\stockflow\\pos-client';
const electronExe = path.join(posClient, "node_modules", "electron", "dist", "electron.exe");
const appDir = path.join(posClient, 'app');


if (!fs.existsSync(electronExe)) {
  console.error("[launcher] ERROR: electron.exe no encontrado en", electronExe);
  process.exit(1);
}

console.log("[launcher] Iniciando Electron...");

// Pasar directamente el archivo main.js en vez del directorio
// para ver si Electron lo busca diferente
const result = spawnSync(electronExe, [path.join(appDir, "main.js")], {
  stdio: ["inherit", "inherit", "pipe"],
  env: { ...process.env },
  cwd: posClient,
  windowsHide: false,
});

if (result.stderr && result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}
if (result.error) {
  console.error("[launcher] Error:", result.error.message);
}
console.log("[launcher] Electron terminó con código:", result.status);
