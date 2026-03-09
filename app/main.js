const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs   = require("fs");

// ─── Rutas según entorno ──────────────────────────────────────────────────────
// En desarrollo: __dirname = pos-client/app/ → ROOT = pos-client/
// Empaquetado:   recursos están en process.resourcesPath
const ROOT = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, "..");

// ─── Config persistence ───────────────────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath("userData"), "pos-config.json");
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(data) {
  const existing = loadConfig();
  fs.writeFileSync(getConfigPath(), JSON.stringify({ ...existing, ...data }, null, 2));
}

// ─── Ventana principal ────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  const preloadPath = app.isPackaged
    ? path.join(process.resourcesPath, "electron", "preload.js")
    : path.join(__dirname, "..", "electron", "preload.js");

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#12121a",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: fs.existsSync(path.join(ROOT, "assets", "icon.ico"))
      ? path.join(ROOT, "assets", "icon.ico")
      : undefined,
    show: false,
  });

  if (!app.isPackaged && process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5174");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const distPath = path.join(ROOT, "dist", "index.html");
    console.log("[POS] Cargando:", distPath, "| existe:", fs.existsSync(distPath));
    mainWindow.loadFile(distPath);
    // Quitar en producción final:
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (e, url) => {
    const isLocal = url.startsWith("file://") || url.startsWith("http://localhost");
    if (!isLocal) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle("config:get", () => loadConfig());

ipcMain.handle("config:set", (_, data) => {
  saveConfig(data);
  return true;
});

ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("print:ticket", async (_, htmlContent) => {
  return new Promise((resolve) => {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true },
    });
    printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(htmlContent));
    printWin.webContents.once("did-finish-load", () => {
      printWin.webContents.print(
        { silent: true, printBackground: true, margins: { marginType: "none" } },
        (success, reason) => {
          printWin.destroy();
          resolve({ success, reason: reason || null });
        }
      );
    });
  });
});

ipcMain.handle("print:getPrinters", () => {
  return mainWindow?.webContents.getPrintersAsync() ?? Promise.resolve([]);
});
