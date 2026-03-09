const STORAGE_MAP = {
  token: "pos_token",
  serverURL: "pos_server_url",
  sucursal_id: "pos_sucursal",
  caja_id: "pos_caja_id",
  caja_nombre: "pos_caja_nombre",
  supervisor_pin: "pos_supervisor_pin",
  nombre_negocio: "pos_nombre_negocio",
  cuit: "pos_cuit",
  direccion: "pos_direccion",
  ticket_footer: "pos_ticket_footer",
  printer_name: "pos_printer_name",
};

function localStorageAvailable() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function toNumberIfNeeded(key, value) {
  if (value == null || value === "") return value;
  if (["sucursal_id", "caja_id"].includes(key)) return Number(value);
  return value;
}

function normalizeServerURL(url) {
  if (!url || typeof url !== "string") return url;
  return url.replace(/\/+$/, "");
}

export function isElectronRuntime() {
  return typeof window !== "undefined" && !!window.electronAPI?.isElectron;
}

export function getRuntimePlatform() {
  if (isElectronRuntime()) return window.electronAPI.platform || "electron";
  return "browser";
}

export async function getRuntimeVersion() {
  if (isElectronRuntime() && window.electronAPI?.getVersion) {
    try {
      return await window.electronAPI.getVersion();
    } catch {
      return "electron";
    }
  }
  return "web";
}

export async function getRuntimeConfig() {
  if (isElectronRuntime()) {
    return window.electronAPI.getConfig();
  }

  if (!localStorageAvailable()) return {};

  const config = {};
  for (const [key, storageKey] of Object.entries(STORAGE_MAP)) {
    const raw = localStorage.getItem(storageKey);
    if (raw != null && raw !== "") {
      config[key] = toNumberIfNeeded(key, raw);
    }
  }

  if (config.serverURL) {
    config.serverURL = normalizeServerURL(config.serverURL);
  }

  return config;
}

export async function setRuntimeConfig(data = {}) {
  if (!data || typeof data !== "object") return true;

  if (isElectronRuntime()) {
    await window.electronAPI.setConfig(data);
    return true;
  }

  if (!localStorageAvailable()) return true;

  for (const [key, value] of Object.entries(data)) {
    const storageKey = STORAGE_MAP[key];
    if (!storageKey) continue;

    if (value == null || value === "") {
      localStorage.removeItem(storageKey);
      continue;
    }

    const safeValue = key === "serverURL" ? normalizeServerURL(String(value)) : String(value);
    localStorage.setItem(storageKey, safeValue);
  }

  return true;
}

export async function printTicketHTML(html, printerName) {
  if (isElectronRuntime() && window.electronAPI?.printTicket) {
    return window.electronAPI.printTicket(html, printerName || undefined);
  }

  const w = window.open("", "_blank");
  if (!w) return { success: false, reason: "popup-blocked" };

  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  w.close();
  return { success: true, reason: null };
}

export async function openCashDrawer(printerName) {
  if (isElectronRuntime() && window.electronAPI?.openDrawer) {
    return window.electronAPI.openDrawer(printerName || undefined);
  }
  return { success: false, reason: "not-supported-in-browser" };
}

export async function getSystemPrinters() {
  if (isElectronRuntime() && window.electronAPI?.getPrinters) {
    return window.electronAPI.getPrinters();
  }
  return [];
}
