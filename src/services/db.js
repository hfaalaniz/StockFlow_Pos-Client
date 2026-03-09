import Dexie from "dexie";

// ─── Schema IndexedDB ─────────────────────────────────────────────────────────
export const db = new Dexie("StockFlowPOS");

db.version(2).stores({
  // Catálogo de productos por sucursal
  productos:         "id, codigo, codigo_barras, nombre, sucursal_id, updated_at",
  clientes:          "id, nombre",
  promociones:       "id, activa",
  categorias:        "id, nombre",

  // Cola de ventas realizadas offline (pendientes de sincronizar)
  ventas_pendientes: "offline_id, created_at, sucursal_id",

  // Ventas en espera (park & resume)
  ventas_en_espera:  "park_id, nombre, created_at",

  // Metadatos de sincronización: última vez que se actualizó cada entidad
  sync_meta:         "key",
});

db.version(3).stores({
  productos:         "id, codigo, codigo_barras, nombre, sucursal_id, updated_at",
  clientes:          "id, nombre",
  promociones:       "id, activa",
  categorias:        "id, nombre",
  ventas_pendientes: "offline_id, created_at, sucursal_id",
  ventas_en_espera:  "park_id, nombre, created_at",
  sync_meta:         "key",
  // Favoritos/acceso rápido: productos fijados por el cajero
  favoritos:         "producto_id, nombre, sucursal_id, pinned_at",
});

// ─── Helpers de sync_meta ─────────────────────────────────────────────────────

export async function getLastSync(entity) {
  const meta = await db.sync_meta.get(entity);
  return meta?.last_sync ?? null;
}

export async function setLastSync(entity, timestamp) {
  await db.sync_meta.put({ key: entity, last_sync: timestamp });
}

/** Verifica si el caché está vencido (más de maxAgeMs sin actualizar). */
export async function isCacheStale(entity, maxAgeMs = 30 * 60 * 1000) {
  const last = await getLastSync(entity);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > maxAgeMs;
}

// ─── Búsqueda local de productos (modo offline) ───────────────────────────────

export async function buscarProductosLocal(q, sucursal_id) {
  if (!q || q.length < 1) return [];
  const ql = q.toLowerCase();

  return db.productos
    .where("sucursal_id").equals(Number(sucursal_id))
    .filter((p) =>
      p.activo !== false && (
        p.codigo_barras === q            // coincidencia exacta de barcode
        || p.codigo?.toLowerCase().includes(ql)
        || p.nombre?.toLowerCase().includes(ql)
      )
    )
    .limit(20)
    .toArray();
}

// ─── Obtener un producto por barcode (coincidencia exacta) ────────────────────

export async function buscarPorBarcode(barcode, sucursal_id) {
  const results = await db.productos
    .where("codigo_barras").equals(barcode)
    .filter((p) => p.sucursal_id === Number(sucursal_id) && p.activo !== false)
    .toArray();
  return results[0] ?? null;
}

// ─── Cola de ventas offline ───────────────────────────────────────────────────

/** Genera un ID único usando crypto.randomUUID() cuando está disponible. */
export function generarOfflineId() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()
    : Math.random().toString(36).slice(2, 12).toUpperCase();
  return `OFF-${Date.now()}-${uuid}`;
}

export async function queueVentaOffline(ventaData) {
  const offline_id = generarOfflineId();
  await db.ventas_pendientes.add({
    offline_id,
    ...ventaData,
    created_at: new Date().toISOString(),
  });
  return offline_id;
}

export async function getPendingVentas() {
  return db.ventas_pendientes.orderBy("created_at").toArray();
}

export async function removePendingVenta(offline_id) {
  await db.ventas_pendientes.delete(offline_id);
}

export async function countPendingVentas() {
  return db.ventas_pendientes.count();
}

// ─── Ventas en espera (Park & Resume) ────────────────────────────────────────

export async function parkCart(nombre, cartData) {
  const park_id = `PARK-${Date.now()}`;
  await db.ventas_en_espera.add({
    park_id,
    nombre: nombre || `Venta ${new Date().toLocaleTimeString("es-AR")}`,
    created_at: new Date().toISOString(),
    ...cartData,
  });
  return park_id;
}

export async function getParkedCarts() {
  return db.ventas_en_espera.orderBy("created_at").toArray();
}

export async function removeParkedCart(park_id) {
  await db.ventas_en_espera.delete(park_id);
}

export async function countParkedCarts() {
  return db.ventas_en_espera.count();
}

// ─── Favoritos (acceso rápido a productos frecuentes) ─────────────────────────

export async function addFavorito(prod) {
  await db.favoritos.put({
    producto_id: prod.id,
    nombre:      prod.nombre,
    precio:      prod.precio,
    stock:       prod.stock,
    codigo_barras: prod.codigo_barras || "",
    sucursal_id: prod.sucursal_id,
    pinned_at:   new Date().toISOString(),
  });
}

export async function removeFavorito(producto_id) {
  await db.favoritos.delete(producto_id);
}

export async function getFavoritos(sucursal_id) {
  return db.favoritos
    .where("sucursal_id").equals(Number(sucursal_id))
    .toArray();
}

export async function isFavorito(producto_id) {
  return !!(await db.favoritos.get(producto_id));
}
