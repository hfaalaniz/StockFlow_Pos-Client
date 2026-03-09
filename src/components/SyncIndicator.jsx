import { useSync } from "../context/SyncContext";
import { useSocket } from "../context/SocketContext";

function timeAgo(date) {
  if (!date) return "nunca";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)  return "hace un momento";
  if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
  return `hace ${Math.floor(secs / 3600)} h`;
}

export function SyncIndicator() {
  const { online, lastSync, syncing, forceDeltaSync } = useSync();
  const { connected } = useSocket();

  const dotColor = connected ? "#48bb78" : (online ? "#e8a923" : "#fc8181");
  const dotTitle = connected ? "Socket conectado" : (online ? "En línea, sin socket" : "Sin conexión");

  return (
    <div
      title={`WS: ${dotTitle} | Sync: ${timeAgo(lastSync)}`}
      onClick={!syncing ? forceDeltaSync : undefined}
      style={{
        position: "fixed",
        bottom: 8,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "#888",
        cursor: syncing ? "default" : "pointer",
        userSelect: "none",
        zIndex: 100,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: connected ? `0 0 4px ${dotColor}` : "none",
          display: "inline-block",
        }}
      />
      <span>
        {syncing ? "Sincronizando..." : `Sync: ${timeAgo(lastSync)}`}
      </span>
    </div>
  );
}
