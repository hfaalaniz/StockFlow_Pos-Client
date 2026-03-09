const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const path = require("path");
const fs   = require("fs");

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#12121a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: fs.existsSync(path.join(__dirname, "../assets/icon.ico"))
      ? path.join(__dirname, "../assets/icon.ico")
      : undefined,
    show: false,
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5174");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const distPath = path.join(__dirname, "../dist/index.html");
    console.log("[POS] Cargando:", distPath, "| existe:", fs.existsSync(distPath));
    mainWindow.loadURL(`file://${distPath.replace(/\\/g, "/")}`);
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
  // Content-Security-Policy para evitar advertencias de Electron
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' file: http://localhost:* ws://localhost:*; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: blob: http://localhost:* https:; " +
          "connect-src 'self' http://localhost:* ws://localhost:*;"
        ],
      },
    });
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle("config:get", () => loadConfig());

ipcMain.handle("config:set", (_, data) => {
  saveConfig(data);
  return true;
});

ipcMain.handle("app:getVersion", () => app.getVersion());

// Fix: usar printer_name guardado en config para la impresión
ipcMain.handle("print:ticket", async (_, htmlContent, printerName) => {
  return new Promise((resolve) => {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true },
    });
    printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(htmlContent));
    printWin.webContents.once("did-finish-load", () => {
      const printOptions = {
        silent: true,
        printBackground: true,
        margins: { marginType: "none" },
      };
      // Fix: pasar deviceName si se especificó una impresora
      if (printerName) {
        printOptions.deviceName = printerName;
      }
      printWin.webContents.print(printOptions, (success, reason) => {
        printWin.destroy();
        resolve({ success, reason: reason || null });
      });
    });
  });
});

ipcMain.handle("print:getPrinters", () => {
  return mainWindow?.webContents.getPrintersAsync() ?? Promise.resolve([]);
});

// Nueva función: abrir cajón de efectivo via ESC/POS (comando estándar)
ipcMain.handle("printer:openDrawer", async (_, printerName) => {
  return new Promise((resolve) => {
    // ESC/POS comando para abrir cajón: ESC p m t1 t2
    const drawerWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true },
    });
    // HTML con script que envía comando de apertura via CSS print trick
    const html = `<html><body>
      <script>
        window.onload = function() {
          // Señal estándar ESC/POS para cajón de efectivo
          document.title = "\x1Bp\x00\x19\xFA";
        }
      </script>
    </body></html>`;
    drawerWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    drawerWin.webContents.once("did-finish-load", () => {
      const printOptions = { silent: true, printBackground: true };
      if (printerName) printOptions.deviceName = printerName;
      drawerWin.webContents.print(printOptions, (success) => {
        drawerWin.destroy();
        resolve({ success });
      });
    });
    // Timeout de seguridad
    setTimeout(() => {
      if (!drawerWin.isDestroyed()) {
        drawerWin.destroy();
        resolve({ success: false, reason: "timeout" });
      }
    }, 5000);
  });
});
