const { contextBridge, ipcRenderer } = require("electron");

// Expone APIs seguras al renderer a través de window.electronAPI
contextBridge.exposeInMainWorld("electronAPI", {
  // Config persistence (JWT, serverURL, sucursal_id, theme, printer_name)
  getConfig: ()       => ipcRenderer.invoke("config:get"),
  setConfig: (data)   => ipcRenderer.invoke("config:set", data),

  // Impresión de ticket térmico (sin diálogo del sistema)
  // Fix: ahora acepta printerName para usar la impresora seleccionada
  printTicket: (html, printerName) => ipcRenderer.invoke("print:ticket", html, printerName),
  getPrinters: ()     => ipcRenderer.invoke("print:getPrinters"),

  // Apertura de cajón de efectivo via ESC/POS
  openDrawer: (printerName) => ipcRenderer.invoke("printer:openDrawer", printerName),

  // Información de la app
  getVersion: ()      => ipcRenderer.invoke("app:getVersion"),
  closeApp: ()        => ipcRenderer.invoke("app:quit"),

  // Ventana
  getFullscreen: ()   => ipcRenderer.invoke("window:getFullscreen"),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggleFullscreen"),

  // Plataforma (para atajos de teclado específicos)
  platform: process.platform,

  // Detectar si estamos dentro de Electron (útil para condicionar comportamiento)
  isElectron: true,
});
