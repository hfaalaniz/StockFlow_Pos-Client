import api from "./api";
import {
  db,
  getLastSync,
  setLastSync,
  getPendingVentas,
  removePendingVenta,
} from "./db";

// ─── Estado de conectividad ───────────────────────────────────────────────────
let _isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
const _listeners = new Set();

// Listeners para ventas offline fallidas
const _flushErrorListeners = new Set();

export function isOnline() { return _isOnline; }

/** Suscribirse a cambios de conectividad. Retorna función para desuscribirse. */
export function onConnectivityChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Suscribirse a errores de flush de cola offline. */
export function onFlushError(fn) {
  _flushErrorListeners.add(fn);
  return () => _flushErrorListeners.delete(fn);
}

function setConnectivityState(online) {
  if (_isOnline === online) return;
  _isOnline = online;
  _listeners.forEach((fn) => fn(online));
  if (online) {
    // Bug #3 fix: primero flush, solo si no hay errores críticos, luego delta
    flushOfflineQueue().then((result) => {
      // Siempre hacer delta después del flush (incluso si hubo errores parciales)
      return fetchDelta();
    }).catch(console.error);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online",  () => setConnectivityState(true));
  window.addEventListener("offline", () => setConnectivityState(false));
}

/** Verifica conectividad real al backend (no solo navigator.onLine). */
export async function checkBackendConnectivity() {
  try {
    await api.get("/pos/status", { timeout: 4000 });
    if (!_isOnline) setConnectivityState(true);
    return true;
  } catch {
    if (_isOnline && !navigator.onLine) setConnectivityState(false);
    return false;
  }
}

// ─── Sincronización completa ──────────────────────────────────────────────────
/** Descarga todo el catálogo desde el servidor. Usar en primer uso o resync forzado. */
export async function fullSync(sucursal_id) {
  if (!_isOnline) throw new Error("Sin conexión al servidor");

  const { data } = await api.get("/pos/sync", { params: { sucursal_id } });

  const {
    productos = [],
    clientes = [],
    promociones = [],
    categorias = [],
    timestamp
  } = data;

  await db.transaction(
    "rw",
    [db.productos, db.clientes, db.promociones, db.categorias, db.sync_meta],
    async () => {
      // Reemplazar productos de esta sucursal
      await db.productos.where("sucursal_id").equals(Number(sucursal_id)).delete();
      await db.productos.bulkPut(
        productos.map((p) => ({ ...p, sucursal_id: Number(sucursal_id) }))
      );

      await db.clientes.clear();
      await db.clientes.bulkPut(clientes);

      await db.promociones.clear();
      await db.promociones.bulkPut(promociones);

      await db.categorias.clear();
      await db.categorias.bulkPut(categorias);
    }
  );

  for (const entity of ["productos", "clientes", "promociones", "categorias"]) {
    await setLastSync(entity, timestamp);
  }

  return {
    count: {
      productos:   productos.length,
      clientes:    clientes.length,
      promociones: promociones.length,
    },
  };
}

// ─── Sincronización delta ─────────────────────────────────────────────────────
/** Descarga solo los cambios desde la última sync. Si no hay historial, hace fullSync. */
export async function fetchDelta(sucursal_id) {
  if (!_isOnline) return { skipped: true };

  const since = await getLastSync("productos");
  if (!since) {
    return fullSync(sucursal_id);
  }

  const { data } = await api.get("/pos/sync/delta", {
    params: { since, sucursal_id },
  });
  const { productos = [], promociones = [], timestamp } = data;

  await db.transaction(
    "rw",
    [db.productos, db.promociones, db.sync_meta],
    async () => {
      if (productos.length > 0) {
        await db.productos.bulkPut(
          productos.map((p) => ({ ...p, sucursal_id: Number(sucursal_id) }))
        );
      }
      if (promociones.length > 0) {
        await db.promociones.clear();
        await db.promociones.bulkPut(promociones);
      }
    }
  );

  await setLastSync("productos", timestamp);

  return { updated: { productos: productos.length, promociones: promociones.length } };
}

// ─── Vaciar cola offline ──────────────────────────────────────────────────────
/** Envía al servidor todas las ventas acumuladas mientras estaba offline.
 *  Bug #2 fix: notifica a listeners cuando una venta falla (stock insuficiente, etc.)
 */
export async function flushOfflineQueue() {
  if (!_isOnline) return { flushed: 0, errors: 0, failedItems: [] };

  const pending = await getPendingVentas();
  if (pending.length === 0) return { flushed: 0, errors: 0, failedItems: [] };

  let flushed = 0;
  let errors  = 0;
  const failedItems = [];

  for (const venta of pending) {
    try {
      const { offline_id, created_at, ...ventaData } = venta;
      await api.post("/pos/ventas", { ...ventaData, offline_id });
      await removePendingVenta(offline_id);
      flushed++;
    } catch (err) {
      // 200 con _offline_sync = true → ya procesada por idempotencia, remover
      if (err.response?.status === 409 || err.response?.data?._offline_sync) {
        await removePendingVenta(venta.offline_id);
        flushed++;
      } else {
        errors++;
        const errorMsg = err.response?.data?.error || err.message || "Error desconocido";
        const failInfo = { offline_id: venta.offline_id, error: errorMsg, venta };
        failedItems.push(failInfo);
        // Notificar a listeners (Bug #2)
        _flushErrorListeners.forEach((fn) => fn(failInfo));
        console.error("[sync] Error al sincronizar venta offline:", venta.offline_id, errorMsg);
      }
    }
  }

  return { flushed, errors, failedItems };
}

// ─── Sync periódico ───────────────────────────────────────────────────────────
let _syncInterval = null;
let _connectivityCheckInterval = null;

export function startPeriodicSync(sucursal_id, intervalMs = 5 * 60 * 1000) {
  stopPeriodicSync();
  _syncInterval = setInterval(() => {
    if (_isOnline) fetchDelta(sucursal_id).catch(console.error);
  }, intervalMs);

  // Verificar conectividad real al backend cada 60s
  _connectivityCheckInterval = setInterval(() => {
    checkBackendConnectivity().catch(() => {});
  }, 60_000);
}

export function stopPeriodicSync() {
  if (_syncInterval) {
    clearInterval(_syncInterval);
    _syncInterval = null;
  }
  if (_connectivityCheckInterval) {
    clearInterval(_connectivityCheckInterval);
    _connectivityCheckInterval = null;
  }
}
