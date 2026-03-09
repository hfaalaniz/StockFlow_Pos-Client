import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  isOnline,
  onConnectivityChange,
  fullSync,
  fetchDelta,
  startPeriodicSync,
  stopPeriodicSync,
} from "../services/sync";
import { countPendingVentas } from "../services/db";

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const { token, sucursalActual } = useAuth();
  const [online, setOnline]           = useState(isOnline());
  const [lastSync, setLastSync]       = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing]         = useState(false);
  const [syncError, setSyncError]     = useState(null);

  const refreshPending = useCallback(async () => {
    const count = await countPendingVentas();
    setPendingCount(count);
  }, []);

  useEffect(() => {
    if (!token) return;

    // Suscribirse a cambios de conectividad
    const unsub = onConnectivityChange(async (nowOnline) => {
      setOnline(nowOnline);
      await refreshPending();
    });

    // Sincronización inicial al montar
    const init = async () => {
      setSyncing(true);
      setSyncError(null);
      try {
        await fullSync(sucursalActual);
        setLastSync(new Date());
      } catch (err) {
        setSyncError(err.message);
        console.warn("[sync] Sync inicial fallida (puede ser offline):", err.message);
      } finally {
        setSyncing(false);
      }
      await refreshPending();
      startPeriodicSync(sucursalActual, 5 * 60 * 1000);
    };

    init();

    return () => {
      unsub();
      stopPeriodicSync();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sucursalActual]);

  /** Llamar después de crear una venta (online u offline) para actualizar el contador */
  const onSaleCreated = useCallback(async () => {
    await refreshPending();
    if (isOnline()) {
      // Actualizar stock delta para reflejar la venta
      fetchDelta(sucursalActual).catch(() => {});
    }
  }, [refreshPending, sucursalActual]);

  /** Forzar sincronización manual (para el SyncIndicator) */
  const forceDeltaSync = useCallback(async () => {
    if (!isOnline()) return;
    setSyncing(true);
    try {
      await fetchDelta(sucursalActual);
      setLastSync(new Date());
    } finally {
      setSyncing(false);
    }
  }, [sucursalActual]);

  return (
    <SyncContext.Provider value={{
      online,
      lastSync,
      pendingCount,
      syncing,
      syncError,
      onSaleCreated,
      forceDeltaSync,
      refreshPending,
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
