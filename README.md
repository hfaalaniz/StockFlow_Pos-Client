# StockFlow POS Client

Aplicación de escritorio Electron para terminales de punto de venta en sucursales.

## Tecnologías

- **Electron 29** — App de escritorio Windows
- **React 18 + Vite** — UI del POS
- **Dexie (IndexedDB)** — Caché offline de productos/clientes/promociones
- **Socket.IO Client** — Actualizaciones en tiempo real bidireccionales
- **axios** — HTTP al backend StockFlow

## Requisitos previos

- Node.js 18+
- Backend StockFlow corriendo (puerto 4000 por defecto)
- Windows 64-bit (para el build del instalador)

## Desarrollo

```bash
# Instalar dependencias
npm install

# Modo desarrollo (Vite en :5174 + Electron)
npm run dev

# Solo el frontend web (sin Electron)
npm run dev:web

# Build web para deploy en navegador
npm run build:web
```

## Build y empaquetado

```bash
# Build de producción + instalador NSIS
npm run release:desktop
# Salida: release/StockFlow POS Setup 1.0.0.exe

# Si NSIS falla por archivos temporales en Windows (C:\Windows\TEMP)
npm run release:desktop:win

# Build pre-configurado para una sucursal específica
DEFAULT_SERVER_URL=http://192.168.1.100:4000 npm run release:desktop

# Solo artefacto Electron (sin instalador)
npm run build:electron

# Solo artefacto Web
npm run release:web
```

Desde cualquier carpeta (por ejemplo `C:\stockflow`), podés usar:

```bash
npm --prefix "c:\stockflow\pos-client" run build:electron
npm --prefix "c:\stockflow\pos-client" run release:desktop
npm --prefix "c:\stockflow\pos-client" run release:desktop:win
npm --prefix "c:\stockflow\pos-client" run build:web
```

## Configuración por sucursal

Al iniciar la app por primera vez, el operador ingresa:
1. **URL del servidor**: IP del backend en la red local (ej: `http://192.168.1.100:4000`)
2. **Email y contraseña** del usuario

La URL se puede pre-configurar en el build o en `AppData\Roaming\stockflow-pos-client\pos-config.json`.

En modo web (browser), la configuración se persiste en `localStorage`:
- `pos_server_url`
- `pos_token`
- `pos_sucursal`
- `pos_caja_id`
- `pos_caja_nombre`

## Modos de build

- `npm run build` -> alias de `build:electron`
- `npm run build:electron` -> build Electron (`vite --mode electron`, `base: "./"`)
- `npm run build:web` -> build Web (`vite --mode web`, `base: "/"`)

## Funcionalidades

- Búsqueda de productos (servidor + fallback IndexedDB offline)
- Scanner de código de barras (detección automática por velocidad de tecleo)
- Carrito con control de stock
- Descuentos manuales y automáticos (desde caché de promociones)
- Métodos de pago: Efectivo, Tarjeta, Transferencia, QR
- Impresión de ticket térmico (sin diálogo del sistema)
- **Modo offline**: ventas se guardan en IndexedDB y sincronizan al reconectarse
- Sincronización delta en tiempo real vía Socket.IO

## API dedicada en el backend

El backend StockFlow expone rutas optimizadas para el POS:

| Endpoint | Descripción |
|---|---|
| `GET /api/pos/status` | Ping de conectividad (sin auth) |
| `GET /api/pos/sync` | Descarga completa del catálogo |
| `GET /api/pos/sync/delta?since=ISO` | Solo cambios desde última sync |
| `GET /api/pos/productos?q=...` | Búsqueda liviana LIMIT 20 |
| `POST /api/pos/ventas` | Crear venta (con soporte offline_id) |

## Estructura del proyecto

```
pos-client/
  electron/
    main.js       — Ventana principal, IPC, impresión
    preload.js    — Bridge contextBridge para renderer
  src/
    context/      — AuthContext, SyncContext, SocketContext
    pages/        — Login, POS, Caja
    services/     — api.js, db.js (Dexie), sync.js
    components/   — OfflineBanner, SyncIndicator
  vite.config.js  — base: "./" (crítico para Electron)
  electron-builder.yml — Empaquetado NSIS Windows
```
