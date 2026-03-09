/**
 * Caja.jsx — Gestión de Turno/Caja para POS Electron
 * Usa los endpoints correctos: POST /caja/turnos y POST /caja/turnos/:id/cerrar
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import toast from "react-hot-toast";

const fmt = (v) => "$" + Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const fmtFecha = (d) => d ? new Date(d).toLocaleString("es-AR") : "—";

export default function Caja() {
  const { sucursalActual, user } = useAuth();
  const navigate = useNavigate();

  // Panel y cajas
  const [cajas, setCajas]         = useState([]);
  const [cajaId, setCajaId]       = useState(null);  // ID de la caja seleccionada
  const [loading, setLoading]     = useState(true);
  const [accion, setAccion]       = useState(null);  // "abrir" | "cerrar"

  // Form apertura
  const [fondoApertura, setFondo] = useState("");

  // Form cierre
  const [efectivoContado, setContado] = useState("");
  const [notas, setNotas]             = useState("");

  // Cargar caja guardada en config al montar
  useEffect(() => {
    const cargarConfig = async () => {
      try {
        if (window.electronAPI?.isElectron) {
          const cfg = await window.electronAPI.getConfig();
          if (cfg.caja_id) setCajaId(Number(cfg.caja_id));
        } else {
          const saved = localStorage.getItem("pos_caja_id");
          if (saved) setCajaId(Number(saved));
        }
      } catch { /* ignorar */ }
    };
    cargarConfig();
  }, []);

  useEffect(() => {
    cargarPanel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalActual]);

  const cargarPanel = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/caja/panel", { params: { sucursal_id: sucursalActual } });
      setCajas(data?.cajas ?? []);
    } catch {
      toast.error("Error al cargar estado de caja");
    } finally {
      setLoading(false);
    }
  };

  const handleAbrirTurno = async (e) => {
    e.preventDefault();
    if (!cajaSeleccionada) return toast.error("Seleccioná una caja primero");
    try {
      await api.post("/caja/turnos", {
        caja_id:       cajaSeleccionada.id,
        fondo_apertura: Number(fondoApertura || 0),
      });
      toast.success("Turno abierto");
      setAccion(null);
      setFondo("");
      cargarPanel();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al abrir turno");
    }
  };

  const handleCerrarTurno = async (e) => {
    e.preventDefault();
    const turnoId = cajaSeleccionada?.turno_activo?.id;
    if (!turnoId) return;
    try {
      await api.post(`/caja/turnos/${turnoId}/cerrar`, {
        efectivo_contado: Number(efectivoContado || 0),
        notas,
      });
      toast.success("Turno cerrado");
      setAccion(null);
      setContado(""); setNotas("");
      cargarPanel();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al cerrar turno");
    }
  };

  const cajaSeleccionada = cajas.find(c => c.id === cajaId) ?? cajas[0] ?? null;
  const turno            = cajaSeleccionada?.turno_activo ?? null;
  const hayTurno         = !!turno;

  if (loading) return (
    <div style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#12121a", color:"#888" }}>
      Cargando...
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#12121a", color:"#cdd6f4" }}>

      {/* Topbar */}
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 20px", borderBottom:"1px solid #313244" }}>
        <button onClick={() => navigate("/pos")}
          style={{ background:"none", border:"none", color:"#888", cursor:"pointer", fontSize:20 }}>←</button>
        <h2 style={{ margin:0, fontSize:16, fontWeight:700 }}>Gestión de Caja</h2>
        <span style={{ marginLeft:"auto", fontSize:12, color:"#888" }}>{user?.nombre}</span>
        <button onClick={() => navigate("/config")}
          title="Configuración"
          style={{ padding:"4px 10px", background:"none", border:"1px solid #313244", borderRadius:6, color:"#888", fontSize:14, cursor:"pointer", lineHeight:1 }}>
          ⚙
        </button>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:24 }}>

        {/* Selector de caja (si hay más de una en la sucursal) */}
        {cajas.length > 1 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:10, color:"#666", fontWeight:700, letterSpacing:1, marginBottom:6 }}>CAJA</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {cajas.map(c => (
                <button key={c.id}
                  onClick={() => { setCajaId(c.id); setAccion(null); }}
                  style={{
                    padding:"6px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600,
                    border:`1px solid ${cajaId === c.id ? "#e8c547" : "#313244"}`,
                    background: cajaId === c.id ? "rgba(232,197,71,0.1)" : "#1e1e2e",
                    color: cajaId === c.id ? "#e8c547" : "#888",
                  }}>
                  {c.nombre}
                  {c.turno_activo && <span style={{ marginLeft:6, fontSize:9, color:"#48bb78" }}>● ABIERTA</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sin cajas configuradas */}
        {cajas.length === 0 && (
          <div style={{ background:"#1e1e2e", borderRadius:12, padding:24, border:"1px solid #313244", textAlign:"center", color:"#666" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🏪</div>
            <div style={{ fontWeight:700, marginBottom:4 }}>No hay cajas configuradas</div>
            <div style={{ fontSize:12 }}>Andá a Configuración para seleccionar la sucursal y caja de este terminal.</div>
            <button onClick={() => navigate("/config")}
              style={{ marginTop:16, padding:"8px 20px", background:"#7c3aed", border:"none", borderRadius:8, color:"#fff", fontWeight:700, cursor:"pointer", fontSize:13 }}>
              Ir a Configuración
            </button>
          </div>
        )}

        {/* Estado actual de la caja seleccionada */}
        {cajaSeleccionada && (
          <div style={{ background:"#1e1e2e", borderRadius:12, padding:20, marginBottom:20, border:"1px solid #313244" }}>
            <div style={{ fontSize:11, color:"#666", fontWeight:700, letterSpacing:1, marginBottom:10 }}>ESTADO ACTUAL — {cajaSeleccionada.nombre}</div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{
                width:12, height:12, borderRadius:"50%",
                background: hayTurno ? "#48bb78" : "#e53e3e",
                boxShadow: `0 0 6px ${hayTurno ? "#48bb78" : "#e53e3e"}`,
              }} />
              <span style={{ fontWeight:700, fontSize:16 }}>
                {hayTurno ? "Turno Abierto" : "Sin Turno Activo"}
              </span>
            </div>

            {turno && (
              <>
                <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                  {[
                    ["Efectivo",  fmt(turno.total_efectivo)],
                    ["Tarjeta",   fmt(turno.total_tarjeta)],
                    ["Transfer.", fmt(turno.total_transferencia)],
                    ["Retiros",   fmt(turno.total_retiros || 0)],
                  ].map(([label, val]) => (
                    <div key={label} style={{ background:"#12121a", borderRadius:8, padding:12 }}>
                      <div style={{ fontSize:11, color:"#666" }}>{label}</div>
                      <div style={{ fontSize:18, fontWeight:700, fontFamily:"monospace", color:"#e8c547" }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:12, color:"#888" }}>
                  <div>Apertura: {fmtFecha(turno.fecha_apertura)}</div>
                  <div>Fondo: {fmt(turno.fondo_apertura)}</div>
                  {turno.usuario_nombre && <div>Cajero: {turno.usuario_nombre}</div>}
                  <div>Total ventas: <span style={{ color:"#e8c547", fontFamily:"monospace", fontWeight:700 }}>{fmt(turno.total_ventas)}</span></div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Botones de acción */}
        {cajaSeleccionada && !accion && (
          <div style={{ display:"flex", gap:12 }}>
            {!hayTurno && (
              <button onClick={() => setAccion("abrir")} style={btnPrimary}>
                Abrir Turno
              </button>
            )}
            {hayTurno && (
              <button onClick={() => setAccion("cerrar")}
                style={{ ...btnPrimary, background:"#e53e3e" }}>
                Cerrar Turno
              </button>
            )}
          </div>
        )}

        {/* Form apertura */}
        {accion === "abrir" && (
          <form onSubmit={handleAbrirTurno}
            style={{ background:"#1e1e2e", borderRadius:12, padding:20, border:"1px solid #313244" }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>
              Abrir Turno — {cajaSeleccionada?.nombre}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={labelStyle}>Fondo de apertura ($)</label>
                <input type="number" value={fondoApertura}
                  onChange={e => setFondo(e.target.value)}
                  placeholder="0" min="0" step="0.01"
                  style={inputStyle} autoFocus />
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button type="button" onClick={() => setAccion(null)} style={btnSecondary}>Cancelar</button>
              <button type="submit" style={btnPrimary}>Confirmar Apertura</button>
            </div>
          </form>
        )}

        {/* Form cierre */}
        {accion === "cerrar" && (
          <form onSubmit={handleCerrarTurno}
            style={{ background:"#1e1e2e", borderRadius:12, padding:20, border:"1px solid #313244" }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>
              Cerrar Turno — {cajaSeleccionada?.nombre}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={labelStyle}>Efectivo contado ($)</label>
                <input type="number" value={efectivoContado}
                  onChange={e => setContado(e.target.value)}
                  placeholder="0" min="0" step="0.01"
                  style={inputStyle} autoFocus required />
              </div>
              <div>
                <label style={labelStyle}>Notas de cierre (opcional)</label>
                <textarea value={notas} onChange={e => setNotas(e.target.value)}
                  rows={3} style={{ ...inputStyle, resize:"vertical" }} />
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button type="button" onClick={() => setAccion(null)} style={btnSecondary}>Cancelar</button>
              <button type="submit" style={{ ...btnPrimary, background:"#e53e3e" }}>Confirmar Cierre</button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}

const inputStyle = {
  width:"100%", background:"#12121a", border:"1px solid #313244", borderRadius:8,
  padding:"9px 12px", color:"#cdd6f4", fontSize:13, outline:"none",
};
const labelStyle = { display:"block", fontSize:11, color:"#888", marginBottom:6, fontWeight:600 };
const btnPrimary = {
  padding:"10px 24px", background:"#7c3aed", border:"none", borderRadius:8,
  color:"#fff", fontWeight:700, cursor:"pointer", fontSize:13,
};
const btnSecondary = {
  padding:"10px 24px", background:"#313244", border:"none", borderRadius:8,
  color:"#cdd6f4", fontWeight:600, cursor:"pointer", fontSize:13,
};
