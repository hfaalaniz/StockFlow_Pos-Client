import { useEffect, useCallback } from "react";
import { useSync } from "../context/SyncContext";
import toast from "react-hot-toast";
import { onFlushError } from "../services/sync";

export function OfflineBanner() {
  const { online, pendingCount, syncError } = useSync();

  // Bug #2 fix: notificar al usuario cuando una venta offline falla al sincronizar
  const handleFlushError = useCallback(({ offline_id, error }) => {
    toast.error(
      `Venta offline ${offline_id} no pudo sincronizarse: ${error}`,
      { duration: 8000, icon: "⚠️" }
    );
  }, []);

  useEffect(() => {
    const unsub = onFlushError(handleFlushError);
    return unsub;
  }, [handleFlushError]);

  const visible = !online || pendingCount > 0 || syncError;
  if (!visible) return null;

  // Determinar color y mensaje según el estado
  let bg = "#e53e3e"; // rojo: sin conexión
  let msg = "SIN CONEXIÓN";
  if (online && pendingCount > 0) {
    bg = "#e8a923"; // naranja: reconectando con pendientes
    msg = "SINCRONIZANDO...";
  } else if (online && syncError) {
    bg = "#e8a923"; // naranja: error de sync
    msg = "ERROR DE SYNC";
  }

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: bg,
      color: "#fff",
      padding: "6px 16px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.05em",
      userSelect: "none",
    }}>
      <span>{msg}</span>
      {pendingCount > 0 && (
        <span>
          · {pendingCount} venta{pendingCount !== 1 ? "s" : ""} pendiente{pendingCount !== 1 ? "s" : ""} de sincronizar
        </span>
      )}
      {syncError && online && (
        <span style={{ fontSize: 11, opacity: 0.85 }}>· {syncError}</span>
      )}
    </div>
  );
}
