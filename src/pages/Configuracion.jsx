/**
 * Configuracion.jsx — Página de configuración del POS
 * Permite ajustar: sucursal, servidor, tema, PIN supervisor, impresora, IVA, etc.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { setServerURL, setAuthToken } from "../services/api";
import api from "../services/api";
import toast from "react-hot-toast";

// ─── Estilos compartidos ───────────────────────────────────────────────────────
const S = {
  page: {
    display: "flex", flexDirection: "column", height: "100vh",
    background: "#12121a", color: "#cdd6f4", overflow: "hidden",
  },
  topbar: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "10px 20px", borderBottom: "1px solid #313244", flexShrink: 0,
  },
  backBtn: {
    background: "none", border: "none", color: "#888",
    cursor: "pointer", fontSize: 20, lineHeight: 1,
  },
  body: {
    flex: 1, overflowY: "auto", padding: "24px 32px", maxWidth: 720,
  },
  section: {
    background: "#1e1e2e", borderRadius: 12, padding: 20,
    border: "1px solid #313244", marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 10, color: "#666", fontWeight: 700,
    letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16,
    paddingBottom: 8, borderBottom: "1px solid #313244",
  },
  row: {
    display: "flex", flexDirection: "column", gap: 6, marginBottom: 14,
  },
  label: {
    fontSize: 11, color: "#888", fontWeight: 600, display: "block",
  },
  input: {
    width: "100%", background: "#12121a", border: "1px solid #313244",
    borderRadius: 8, padding: "9px 12px", color: "#cdd6f4",
    fontSize: 13, outline: "none",
  },
  select: {
    width: "100%", background: "#12121a", border: "1px solid #313244",
    borderRadius: 8, padding: "9px 12px", color: "#cdd6f4",
    fontSize: 13, outline: "none", cursor: "pointer",
  },
  btnPrimary: {
    padding: "9px 20px", background: "#7c3aed", border: "none",
    borderRadius: 8, color: "#fff", fontWeight: 700,
    cursor: "pointer", fontSize: 13,
  },
  btnSecondary: {
    padding: "9px 20px", background: "#313244", border: "none",
    borderRadius: 8, color: "#cdd6f4", fontWeight: 600,
    cursor: "pointer", fontSize: 13,
  },
  btnDanger: {
    padding: "9px 20px", background: "rgba(229,62,62,0.15)",
    border: "1px solid rgba(229,62,62,0.4)",
    borderRadius: 8, color: "#e53e3e", fontWeight: 600,
    cursor: "pointer", fontSize: 13,
  },
  hint: { fontSize: 11, color: "#555", marginTop: 3 },
  statusDot: (ok) => ({
    display: "inline-block", width: 8, height: 8,
    borderRadius: "50%", background: ok ? "#48bb78" : "#e53e3e",
    marginRight: 6,
  }),
  themeBtn: (active) => ({
    padding: "8px 16px", borderRadius: 8,
    border: `1px solid ${active ? "#e8c547" : "#313244"}`,
    background: active ? "rgba(232,197,71,0.12)" : "#12121a",
    color: active ? "#e8c547" : "#888",
    fontWeight: active ? 700 : 400,
    cursor: "pointer", fontSize: 12,
  }),
};

// ─── Sección: Servidor ────────────────────────────────────────────────────────
function SeccionServidor({ serverURL, onSaved }) {
  const [url, setUrl] = useState(serverURL || "http://localhost:4000");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null); // null | "ok" | "error"

  const probar = async () => {
    setTesting(true); setStatus(null);
    try {
      const base = url.replace(/\/+$/, "");
      setServerURL(base);
      await api.get("/pos/status");
      setStatus("ok");
      toast.success("Servidor accesible");
    } catch {
      setStatus("error");
      toast.error("No se pudo conectar al servidor");
    } finally { setTesting(false); }
  };

  const guardar = async () => {
    const base = url.replace(/\/+$/, "");
    setServerURL(base);
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.setConfig({ serverURL: base });
    } else {
      localStorage.setItem("pos_server_url", base);
    }
    onSaved(base);
    toast.success("URL del servidor guardada");
  };

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Servidor</div>
      <div style={S.row}>
        <label style={S.label}>URL del servidor (IP de la red local)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            value={url}
            onChange={e => { setUrl(e.target.value); setStatus(null); }}
            placeholder="http://192.168.1.x:4000"
          />
          <button onClick={probar} disabled={testing} style={S.btnSecondary}>
            {testing ? "Probando…" : "Probar"}
          </button>
        </div>
        {status && (
          <span style={{ fontSize: 12, color: status === "ok" ? "#48bb78" : "#e53e3e" }}>
            <span style={S.statusDot(status === "ok")} />
            {status === "ok" ? "Servidor accesible" : "Sin respuesta"}
          </span>
        )}
        <p style={S.hint}>URL del backend StockFlow (ej: http://192.168.1.10:4000)</p>
      </div>
      <button onClick={guardar} style={S.btnPrimary}>Guardar URL</button>
    </div>
  );
}

// ─── Sección: Sucursal y Caja ─────────────────────────────────────────────────
function SeccionSucursal({ sucursalActual, onSaved }) {
  const [sucursales, setSucursales] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [sucId, setSucId] = useState(sucursalActual || "");
  const [cajaId, setCajaId] = useState("");
  const [cajaNombre, setCajaNombre] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      try {
        const [{ data: sData }, { data: cData }] = await Promise.all([
          api.get("/sucursales"),
          api.get("/cajas"),
        ]);
        const sucList = sData?.data ?? sData ?? [];
        const cajList = cData?.data ?? cData ?? [];
        setSucursales(sucList);
        setCajas(cajList);

        // Cargar config guardada
        let savedCajaId = "";
        let savedCajaNombre = "";
        if (window.electronAPI?.isElectron) {
          const cfg = await window.electronAPI.getConfig();
          savedCajaId = cfg.caja_id || "";
          savedCajaNombre = cfg.caja_nombre || "";
        } else {
          savedCajaId = localStorage.getItem("pos_caja_id") || "";
          savedCajaNombre = localStorage.getItem("pos_caja_nombre") || "";
        }
        setCajaId(String(savedCajaId));
        setCajaNombre(savedCajaNombre || "Caja Principal");
      } catch (err) {
        toast.error("Error al cargar sucursales/cajas");
      } finally { setLoading(false); }
    };
    cargar();
  }, []);

  // Filtrar cajas por sucursal seleccionada
  const cajasFiltradas = cajas.filter(c =>
    !sucId || String(c.sucursal_id) === String(sucId)
  );

  const guardar = async () => {
    const data = {
      sucursal_id: sucId ? Number(sucId) : null,
      caja_id: cajaId ? Number(cajaId) : null,
      caja_nombre: cajaNombre,
    };
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.setConfig(data);
    } else {
      if (data.sucursal_id) localStorage.setItem("pos_sucursal", String(data.sucursal_id));
      if (data.caja_id) localStorage.setItem("pos_caja_id", String(data.caja_id));
      if (data.caja_nombre) localStorage.setItem("pos_caja_nombre", data.caja_nombre);
    }
    onSaved(data);
    toast.success("Sucursal y caja guardadas");
  };

  if (loading) return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Sucursal y Caja</div>
      <div style={{ color: "#888", fontSize: 13 }}>Cargando…</div>
    </div>
  );

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Sucursal y Caja</div>

      <div style={S.row}>
        <label style={S.label}>Sucursal</label>
        <select
          style={S.select}
          value={sucId}
          onChange={e => { setSucId(e.target.value); setCajaId(""); }}
        >
          <option value="">Seleccionar sucursal…</option>
          {sucursales.map(s => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
        <p style={S.hint}>Sucursal donde está instalado este terminal POS</p>
      </div>

      <div style={S.row}>
        <label style={S.label}>Caja física asignada</label>
        <select
          style={S.select}
          value={cajaId}
          onChange={e => {
            const caja = cajas.find(c => String(c.id) === e.target.value);
            setCajaId(e.target.value);
            if (caja) setCajaNombre(caja.nombre);
          }}
          disabled={!sucId}
        >
          <option value="">Seleccionar caja…</option>
          {cajasFiltradas.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}{c.descripcion ? ` — ${c.descripcion}` : ""}</option>
          ))}
        </select>
        {cajasFiltradas.length === 0 && sucId && (
          <span style={{ fontSize: 11, color: "#e8a923" }}>
            No hay cajas configuradas para esta sucursal
          </span>
        )}
      </div>

      <div style={S.row}>
        <label style={S.label}>Nombre del terminal (visible en tickets)</label>
        <input
          style={S.input}
          value={cajaNombre}
          onChange={e => setCajaNombre(e.target.value)}
          placeholder="Ej: Caja Principal, Terminal 1…"
        />
      </div>

      <button onClick={guardar} style={S.btnPrimary}>Guardar</button>
    </div>
  );
}

// ─── Sección: Operador / Seguridad ────────────────────────────────────────────
function SeccionOperador() {
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);

  const guardarPin = async () => {
    if (!pin || pin.length < 4) return toast.error("El PIN debe tener al menos 4 dígitos");
    if (pin !== pinConfirm) return toast.error("Los PINs no coinciden");
    if (!/^\d+$/.test(pin)) return toast.error("El PIN solo puede contener números");

    const data = { supervisor_pin: pin };
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.setConfig(data);
    } else {
      localStorage.setItem("pos_supervisor_pin", pin);
    }
    setPin(""); setPinConfirm("");
    toast.success("PIN de supervisor guardado");
  };

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Seguridad</div>

      <div style={S.row}>
        <label style={S.label}>PIN de supervisor (para desbloquear caja y acceder a funciones avanzadas)</label>
        <div style={{ position: "relative" }}>
          <input
            type={showPin ? "text" : "password"}
            style={{ ...S.input, letterSpacing: showPin ? "normal" : 4 }}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Nuevo PIN (solo números)"
            maxLength={8}
          />
          <button
            type="button"
            onClick={() => setShowPin(v => !v)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12 }}
          >
            {showPin ? "Ocultar" : "Ver"}
          </button>
        </div>
      </div>

      <div style={S.row}>
        <label style={S.label}>Confirmar PIN</label>
        <input
          type={showPin ? "text" : "password"}
          style={{ ...S.input, letterSpacing: showPin ? "normal" : 4 }}
          value={pinConfirm}
          onChange={e => setPinConfirm(e.target.value.replace(/\D/g, ""))}
          placeholder="Repetir PIN"
          maxLength={8}
        />
      </div>

      <button onClick={guardarPin} style={S.btnPrimary}>Guardar PIN</button>
    </div>
  );
}

// ─── Sección: Apariencia ──────────────────────────────────────────────────────
function SeccionApariencia() {
  const { theme, setTheme } = useTheme();
  const themes = [
    { key: "gold",  label: "Gold",  color: "#e8c547" },
    { key: "dark",  label: "Oscuro", color: "#6366f1" },
    { key: "light", label: "Claro", color: "#2563eb" },
  ];

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Apariencia</div>

      <div style={S.row}>
        <label style={S.label}>Tema de color</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {themes.map(t => (
            <button
              key={t.key}
              onClick={() => { setTheme(t.key); toast.success(`Tema "${t.label}" aplicado`); }}
              style={{
                ...S.themeBtn(theme === t.key),
                borderColor: theme === t.key ? t.color : "#313244",
                color: theme === t.key ? t.color : "#888",
                background: theme === t.key ? `${t.color}18` : "#12121a",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, display: "inline-block" }} />
              {t.label}
              {theme === t.key && " ✓"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sección: Impresora ───────────────────────────────────────────────────────
function SeccionImpresora() {
  const [printers, setPrinters] = useState([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cargar = async () => {
      if (!window.electronAPI?.isElectron) return;
      setLoading(true);
      try {
        const list = await window.electronAPI.getPrinters();
        setPrinters(list);
        const cfg = await window.electronAPI.getConfig();
        setSelected(cfg.printer_name || "");
      } catch { /* no hay impresoras */ }
      finally { setLoading(false); }
    };
    cargar();
  }, []);

  const guardar = async () => {
    if (!window.electronAPI?.isElectron) return toast.error("Solo disponible en modo escritorio");
    await window.electronAPI.setConfig({ printer_name: selected });
    toast.success("Impresora guardada");
  };

  if (!window.electronAPI?.isElectron) {
    return (
      <div style={S.section}>
        <div style={S.sectionTitle}>Impresora</div>
        <p style={{ fontSize: 12, color: "#555" }}>La gestión de impresoras solo está disponible en la aplicación de escritorio.</p>
      </div>
    );
  }

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Impresora</div>

      <div style={S.row}>
        <label style={S.label}>Impresora de tickets</label>
        {loading ? (
          <p style={{ fontSize: 12, color: "#888" }}>Cargando impresoras…</p>
        ) : (
          <select style={S.select} value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Impresora predeterminada del sistema</option>
            {printers.map(p => (
              <option key={p.name} value={p.name}>{p.displayName || p.name}</option>
            ))}
          </select>
        )}
        <p style={S.hint}>Seleccioná la impresora térmica para los tickets de venta</p>
      </div>

      <button onClick={guardar} style={S.btnPrimary} disabled={loading}>Guardar impresora</button>
    </div>
  );
}

// ─── Sección: Ticket/Negocio ──────────────────────────────────────────────────
function SeccionTicket() {
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [cuit, setCuit]                   = useState("");
  const [direccion, setDireccion]         = useState("");
  const [footer, setFooter]               = useState("");
  const [loaded, setLoaded]               = useState(false);

  useEffect(() => {
    const cargar = async () => {
      try {
        const src = window.electronAPI?.isElectron
          ? await window.electronAPI.getConfig()
          : { nombre_negocio: localStorage.getItem("pos_nombre_negocio") || "",
              cuit: localStorage.getItem("pos_cuit") || "",
              direccion: localStorage.getItem("pos_direccion") || "",
              ticket_footer: localStorage.getItem("pos_ticket_footer") || "" };
        setNombreNegocio(src.nombre_negocio || "");
        setCuit(src.cuit || "");
        setDireccion(src.direccion || "");
        setFooter(src.ticket_footer || "Gracias por su compra");
      } catch { /* ignorar */ }
      setLoaded(true);
    };
    cargar();
  }, []);

  const guardar = async () => {
    const data = { nombre_negocio: nombreNegocio, cuit, direccion, ticket_footer: footer };
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.setConfig(data);
    } else {
      Object.entries({ pos_nombre_negocio: nombreNegocio, pos_cuit: cuit, pos_direccion: direccion, pos_ticket_footer: footer })
        .forEach(([k, v]) => v ? localStorage.setItem(k, v) : localStorage.removeItem(k));
    }
    toast.success("Configuración del ticket guardada");
  };

  if (!loaded) return null;

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Ticket / Comprobante</div>

      <div style={S.row}>
        <label style={S.label}>Nombre del negocio (aparece en el encabezado del ticket)</label>
        <input style={S.input} value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)} placeholder="Ej: Mi Tienda SRL" />
      </div>

      <div style={S.row}>
        <label style={S.label}>CUIT (opcional)</label>
        <input style={S.input} value={cuit} onChange={e => setCuit(e.target.value)} placeholder="Ej: 30-12345678-9" />
      </div>

      <div style={S.row}>
        <label style={S.label}>Dirección del local (opcional)</label>
        <input style={S.input} value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Ej: Av. Corrientes 1234, CABA" />
      </div>

      <div style={S.row}>
        <label style={S.label}>Mensaje de pie de ticket</label>
        <input style={S.input} value={footer} onChange={e => setFooter(e.target.value)} placeholder="Ej: Gracias por su compra. ¡Vuelva pronto!" />
      </div>

      <button onClick={guardar} style={S.btnPrimary}>Guardar configuración del ticket</button>
    </div>
  );
}

// ─── Sección: Sistema ─────────────────────────────────────────────────────────
function SeccionSistema({ serverURL }) {
  const [version, setVersion] = useState("—");

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getVersion?.().then(v => setVersion(v)).catch(() => {});
    }
  }, []);

  const limpiarCache = () => {
    if (!confirm("¿Limpiar el caché local de productos, promociones y clientes?")) return;
    import("../services/db").then(({ db }) => {
      Promise.all([
        db.productos.clear(),
        db.promociones.clear(),
        db.clientes.clear(),
      ]).then(() => toast.success("Caché limpiado correctamente"))
        .catch(() => toast.error("Error al limpiar caché"));
    });
  };

  const ConfigRow = ({ label, value }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0",
      borderBottom: "1px solid #252535", fontSize: 12 }}>
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ fontFamily: "monospace", color: "#cdd6f4" }}>{value}</span>
    </div>
  );

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Sistema</div>

      <ConfigRow label="Versión"        value={version} />
      <ConfigRow label="Servidor"       value={serverURL || "localhost:4000"} />
      <ConfigRow label="Plataforma"     value={window.electronAPI?.platform || "browser"} />
      <ConfigRow label="Modo"           value={window.electronAPI?.isElectron ? "Escritorio (Electron)" : "Navegador"} />

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={limpiarCache} style={S.btnDanger}>
          Limpiar caché local
        </button>
      </div>
      <p style={{ ...S.hint, marginTop: 8 }}>
        El caché local contiene productos, clientes y promociones sincronizados. Limpiar fuerza una re-sincronización.
      </p>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Configuracion() {
  const navigate = useNavigate();
  const { sucursalActual, serverURL } = useAuth();
  const [liveServerURL, setLiveServerURL] = useState(serverURL || "http://localhost:4000");

  const handleSucursalSaved = useCallback((data) => {
    // Recargar la app si cambia la sucursal (para que AuthContext tome el nuevo valor)
    if (data.sucursal_id && data.sucursal_id !== sucursalActual) {
      setTimeout(() => window.location.reload(), 800);
    }
  }, [sucursalActual]);

  return (
    <div style={S.page}>
      {/* Topbar */}
      <div style={S.topbar}>
        <button onClick={() => navigate(-1)} style={S.backBtn} title="Volver">←</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Configuración</h2>
        <span style={{ fontSize: 11, color: "#555", marginLeft: "auto" }}>
          StockFlow POS
        </span>
      </div>

      {/* Cuerpo */}
      <div style={S.body}>
        <SeccionServidor serverURL={liveServerURL} onSaved={setLiveServerURL} />
        <SeccionSucursal sucursalActual={sucursalActual} onSaved={handleSucursalSaved} />
        <SeccionOperador />
        <SeccionApariencia />
        <SeccionImpresora />
        <SeccionTicket />
        <SeccionSistema serverURL={liveServerURL} />
      </div>
    </div>
  );
}
