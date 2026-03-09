import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";
import api from "../services/api";
import { db } from "../services/db";
import { fetchDelta, fullSync } from "../services/sync";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, serverURL, sucursalActual } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token || !serverURL) return;

    const socket = io(serverURL, {
      auth: { token },
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("pos:heartbeat", {
        sucursal_id: sucursalActual,
        terminal_id: `POS-${navigator.userAgent.slice(0, 20)}`,
      });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("pos:heartbeat:ack", ({ server_time }) => {
      console.log("[socket] Registrado en sucursal:", sucursalActual, "| server_time:", server_time);
    });

    // Stock cambió en esta sucursal — actualizar productos afectados en IndexedDB
    // Bug #8 fix: timestamp guard para evitar sobrescribir datos más nuevos
    socket.on("pos:stock_actualizado", async ({ sucursal_id, productos: productoIds, server_time }) => {
      if (Number(sucursal_id) !== Number(sucursalActual)) return;
      if (!productoIds?.length) return;
      try {
        const { data } = await api.get("/pos/productos", {
          params: { q: "", sucursal_id, limit: 200 },
        });
        const lista = Array.isArray(data) ? data : (data?.data || []);
        const afectados = lista.filter(p => productoIds.includes(p.id));
        if (afectados.length > 0) {
          // Comparar timestamps: solo actualizar si el dato del servidor es más nuevo
          const updates = [];
          for (const prod of afectados) {
            const local = await db.productos.get(prod.id);
            const localTime = local?.updated_at ? new Date(local.updated_at).getTime() : 0;
            const serverTimeParsed = prod.updated_at ? new Date(prod.updated_at).getTime() : (server_time ? new Date(server_time).getTime() : Date.now());
            if (serverTimeParsed >= localTime) {
              updates.push({ ...prod, sucursal_id: Number(sucursal_id) });
            }
          }
          if (updates.length > 0) {
            await db.productos.bulkPut(updates);
          }
        }
      } catch (err) {
        console.warn("[socket] Error actualizando stock:", err.message);
      }
    });

    // Precio/datos de un producto cambiaron
    socket.on("pos:producto_actualizado", async ({ producto_id }) => {
      if (!producto_id) return;
      try {
        const { data } = await api.get("/pos/productos", {
          params: { q: String(producto_id), sucursal_id: sucursalActual },
        });
        const lista = Array.isArray(data) ? data : (data?.data || []);
        if (lista.length > 0) {
          await db.productos.put({ ...lista[0], sucursal_id: Number(sucursalActual) });
        }
      } catch (err) {
        console.warn("[socket] Error actualizando producto:", err.message);
      }
    });

    // Promociones cambiaron → recargar lista completa
    socket.on("pos:promocion_actualizada", async () => {
      try {
        const { data } = await api.get("/promociones");
        const lista = Array.isArray(data) ? data : (data?.data || []);
        if (lista.length > 0) {
          await db.promociones.clear();
          await db.promociones.bulkPut(lista);
        }
      } catch (err) {
        console.warn("[socket] Error actualizando promociones:", err.message);
      }
    });

    // Admin forzó resync completo
    socket.on("pos:sync_required", async ({ reason } = {}) => {
      console.log("[socket] Resync requerido:", reason);
      try {
        await fullSync(sucursalActual);
      } catch {
        await fetchDelta(sucursalActual);
      }
    });

    // Heartbeat cada 30s para mantener membresía en la sala de la sucursal
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit("pos:heartbeat", { sucursal_id: sucursalActual });
      }
    }, 30_000);

    return () => {
      clearInterval(heartbeatInterval);
      socket.disconnect();
    };
  }, [token, serverURL, sucursalActual]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
