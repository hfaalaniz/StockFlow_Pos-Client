/**
 * POS.jsx — Punto de Venta dedicado para Electron
 * v2 — incluye todas las mejoras:
 *   - PIN supervisor leído desde config (no hardcodeado)
 *   - Prevención de doble-click en COBRAR
 *   - Verificación de turno real al iniciar
 *   - NumpadModal con validación de stock máximo
 *   - Park & Resume (ventas en espera)
 *   - Reimpresión de tickets desde historial
 *   - Historial de ventas del turno + anulación
 *   - Resumen de turno en topbar
 *   - Puntos de fidelización (mostrar y canjear)
 *   - QR de pago dinámico
 *   - Nota/observación en venta
 *   - Apertura de cajón de efectivo post-impresión
 *   - Ticket customizable (nombre negocio, footer)
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSync } from "../context/SyncContext";
import { OfflineBanner } from "../components/OfflineBanner";
import { SyncIndicator } from "../components/SyncIndicator";
import api from "../services/api";
import {
  buscarProductosLocal,
  buscarPorBarcode,
  queueVentaOffline,
  db,
  parkCart,
  getParkedCarts,
  removeParkedCart,
  addFavorito,
  removeFavorito,
  getFavoritos,
  isFavorito,
} from "../services/db";
import { isOnline } from "../services/sync";
import toast from "react-hot-toast";
import {
  getRuntimeConfig,
  isElectronRuntime,
  openCashDrawer,
  printTicketHTML,
} from "../services/runtime";

// ─── Constantes ───────────────────────────────────────────────────────────────
const IVA_RATE = 0.21;
const METODOS_PAGO = [
  { val: "efectivo",        label: "Efectivo",       icon: "💵", key: "1" },
  { val: "tarjeta_debito",  label: "Débito",          icon: "💳", key: "2" },
  { val: "tarjeta_credito", label: "Crédito",         icon: "💳", key: "3" },
  { val: "transferencia",   label: "Transferencia",   icon: "🏦", key: "4" },
  { val: "qr",              label: "QR / Billetera",  icon: "📱", key: "5" },
  { val: "mercadopago",     label: "Mercado Pago",    icon: "🔵", key: "6" },
  { val: "gift_card",       label: "Gift Card",       icon: "🎁", key: "7" },
];

const fmt = (v) => "$" + Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OPERATOR_MODE = true;

// ─── Calcular descuentos offline ──────────────────────────────────────────────
async function calcularDescuentosOffline(items, clienteId) {
  try {
    const promos = await db.promociones.where("activa").equals(1).toArray();
    const subtotal = items.reduce((s, i) => s + i.precio_unit * i.cantidad, 0);
    let descuentoTotal = 0;
    const detalles = [];

    for (const promo of promos) {
      const now = new Date();
      const inicio = promo.fecha_inicio ? new Date(promo.fecha_inicio) : null;
      const fin    = promo.fecha_fin    ? new Date(promo.fecha_fin)    : null;
      if (inicio && inicio > now) continue;
      if (fin    && fin    < now) continue;

      let monto = 0;
      switch (promo.tipo) {
        case "porcentaje":
          monto = subtotal * (promo.valor / 100);
          break;
        case "monto_fijo":
          monto = Number(promo.valor);
          break;
        case "cantidad_minima": {
          const cantTotal = items.reduce((s, i) => s + i.cantidad, 0);
          if (cantTotal >= promo.cantidad_minima) monto = subtotal * (promo.valor / 100);
          break;
        }
        case "cliente_especifico":
          if (clienteId && Number(clienteId) === Number(promo.cliente_id))
            monto = subtotal * (promo.valor / 100);
          break;
      }
      if (monto > 0) {
        descuentoTotal += monto;
        detalles.push({ nombre: promo.nombre, monto });
      }
    }
    return { descuentoTotal, detalles };
  } catch {
    return { descuentoTotal: 0, detalles: [] };
  }
}

// ─── Generar HTML de ticket ───────────────────────────────────────────────────
function generarHTMLTicket(ticket, config = {}) {
  const nombreNegocio = config.nombre_negocio || "StockFlow POS";
  const footer = config.ticket_footer || "Gracias por su compra";
  const cuit   = config.cuit ? `CUIT: ${config.cuit}` : "";
  const dir    = config.direccion || "";

  return `<html><head><meta charset="utf-8"/>
    <style>
      body { font-family: monospace; font-size: 12px; width: 300px; padding: 10px; margin: 0; }
      h2 { text-align: center; margin: 0 0 2px; font-size: 15px; }
      .center { text-align: center; }
      .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
      .total-row { font-weight: bold; font-size: 15px; border-top: 1px dashed #000; padding-top: 5px; margin-top: 5px; }
      .footer { text-align: center; margin-top: 10px; font-size: 11px; border-top: 1px dashed #000; padding-top: 6px; }
      .offline-warn { color: red; text-align: center; font-weight: bold; margin-top: 6px; }
    </style>
  </head><body>
    <h2>${nombreNegocio}</h2>
    ${dir ? `<div class="center" style="font-size:11px">${dir}</div>` : ""}
    ${cuit ? `<div class="center" style="font-size:11px">${cuit}</div>` : ""}
    <div class="center" style="margin:6px 0;font-size:11px">${ticket.offline ? "VENTA OFFLINE" : "TICKET DE VENTA"}</div>
    <div class="row"><span>N°:</span><span>${ticket.numero}</span></div>
    <div class="row"><span>Fecha:</span><span>${new Date().toLocaleString("es-AR")}</span></div>
    ${ticket.cliente_nombre && ticket.cliente_nombre !== "Consumidor Final"
      ? `<div class="row"><span>Cliente:</span><span>${ticket.cliente_nombre}</span></div>` : ""}
    ${ticket.nota ? `<div class="row"><span>Obs:</span><span>${ticket.nota}</span></div>` : ""}
    <hr style="border:none;border-top:1px dashed #000;margin:6px 0"/>
    ${ticket.items.map(i => `
      <div>${i.nombre}</div>
      <div class="row"><span style="padding-left:10px">${i.cantidad} x ${fmt(i.precio_unit)}</span><span>${fmt(i.subtotal)}</span></div>
    `).join("")}
    <hr style="border:none;border-top:1px dashed #000;margin:6px 0"/>
    ${ticket.descuento > 0 ? `<div class="row"><span>Descuento:</span><span>-${fmt(ticket.descuento)}</span></div>` : ""}
    ${ticket.puntosCanjeados > 0 ? `<div class="row"><span>Pts. canjeados:</span><span>-${fmt(ticket.puntosCanjeados)}</span></div>` : ""}
    <div class="row total-row"><span>TOTAL</span><span>${fmt(ticket.total)}</span></div>
    ${ticket.pagos.map(p => `<div class="row"><span>${p.metodo_pago}</span><span>${fmt(p.monto)}</span></div>`).join("")}
    ${ticket.vuelto > 0 ? `<div class="row" style="color:green"><span>Vuelto:</span><span>${fmt(ticket.vuelto)}</span></div>` : ""}
    ${ticket.puntosGanados > 0 ? `<div class="row" style="color:#555;font-size:11px"><span>Puntos ganados:</span><span>${ticket.puntosGanados}</span></div>` : ""}
    ${ticket.offline ? `<div class="offline-warn">[PENDIENTE SINCRONIZACIÓN]</div>` : ""}
    <div class="footer">${footer}</div>
  </body></html>`;
}

// ─── Helper: imprimir HTML ────────────────────────────────────────────────────
async function imprimirHTML(html, config = {}) {
  const printerName = config?.printer_name || "";
  const result = await printTicketHTML(html, printerName || undefined);
  if (!result?.success) {
    toast.error(`Error al imprimir: ${result?.reason || "desconocido"}`);
  }
  return result;
}

// ─── NumpadModal ──────────────────────────────────────────────────────────────
function NumpadModal({ title, value, maxValue, onConfirm, onClose }) {
  const [val, setVal] = useState(String(value));
  const [warn, setWarn] = useState("");

  const press = (k) => {
    if (k === "C")  { setVal(""); setWarn(""); return; }
    if (k === "⌫") { setVal(v => v.slice(0, -1) || ""); setWarn(""); return; }
    if (k === "OK") {
      const num = Number(val) || 1;
      if (maxValue !== undefined && num > maxValue) {
        setWarn(`Máximo disponible: ${maxValue}`);
        return;
      }
      onConfirm(num);
      return;
    }
    const next = val === "0" ? k : val + k;
    const num = Number(next);
    if (maxValue !== undefined && num > maxValue) {
      setWarn(`Máximo disponible: ${maxValue}`);
    } else {
      setWarn("");
    }
    setVal(next);
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "Enter") {
        const num = Number(val) || 1;
        if (maxValue !== undefined && num > maxValue) { setWarn(`Máximo: ${maxValue}`); return; }
        onConfirm(num);
        return;
      }
      if (e.key === "Escape")    { onClose(); return; }
      if (/^\d$/.test(e.key)) {
        const next = val + e.key;
        const num = Number(next);
        if (maxValue !== undefined && num > maxValue) setWarn(`Máximo disponible: ${maxValue}`);
        else setWarn("");
        setVal(next);
      }
      if (e.key === "Backspace") { setVal(v => v.slice(0, -1)); setWarn(""); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [val, onConfirm, onClose, maxValue]);

  const keys = ["7","8","9","4","5","6","1","2","3","C","0","⌫","OK"];
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:14, padding:24, width:280, boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize:13, color:"var(--muted2)", marginBottom:8 }}>{title}</div>
        {maxValue !== undefined && (
          <div style={{ fontSize:11, color:"var(--muted)", marginBottom:4 }}>Stock disponible: {maxValue}</div>
        )}
        <div style={{ fontSize:32, fontFamily:"monospace", fontWeight:700, color:"var(--accent)", padding:"10px 14px", background:"var(--border2)", borderRadius:8, textAlign:"right", marginBottom: warn ? 4 : 14 }}>
          {val || "0"}
        </div>
        {warn && <div style={{ color:"var(--danger)", fontSize:11, marginBottom:10, textAlign:"center" }}>{warn}</div>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
          {keys.map(k => (
            <button key={k} onClick={() => press(k)} style={{
              padding: "12px 0", borderRadius:8, border:"none", cursor:"pointer",
              fontWeight:700, fontSize:15,
              background: k === "OK" ? "var(--accent)" : k === "C" ? "#c0392b" : "var(--surface3)",
              color: k === "OK" ? "#0b1a2b" : "#fff",
            }}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MetodoSelector ───────────────────────────────────────────────────────────
function MetodoSelectorPOS({ value, onChange, excluir = [] }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
      {METODOS_PAGO.map((m) => {
        const disabled = excluir.includes(m.val);
        const selected = value === m.val;
        return (
          <button key={m.val} onClick={() => !disabled && onChange(m.val)} disabled={disabled}
            style={{
              padding:"10px 6px", borderRadius:10,
              border: `2px solid ${selected ? "var(--accent)" : "var(--border2)"}`,
              background: selected ? "rgba(var(--accent-rgb),0.12)" : disabled ? "var(--surface2)" : "var(--bg)",
              cursor: disabled ? "not-allowed" : "pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:3,
              opacity: disabled ? 0.3 : 1,
            }}>
            <span style={{ fontSize:18, lineHeight:1 }}>{m.icon}</span>
            <span style={{ fontSize:10, fontWeight:700, color: selected ? "var(--accent)" : "var(--muted2)" }}>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── QRModal — muestra QR de pago ────────────────────────────────────────────
function QRModal({ total, metodo, onClose }) {
  const [qrUrl, setQrUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const generar = async () => {
      try {
        const { data } = await api.post("/pos/qr-pago", { monto: total, metodo });
        setQrUrl(data.qr_url || data.qr_data);
      } catch {
        // Fallback: QR con info del monto
        setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`Pago ${metodo} $${total.toFixed(2)}`)}`);
      } finally {
        setLoading(false);
      }
    };
    generar();
  }, [total, metodo]);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, padding:28, width:320, textAlign:"center", boxShadow:"0 24px 64px rgba(0,0,0,0.7)" }}>
        <div style={{ fontSize:13, color:"var(--muted2)", marginBottom:4, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>
          {metodo === "qr" ? "QR de Pago" : "Mercado Pago"}
        </div>
        <div style={{ fontSize:26, fontFamily:"monospace", fontWeight:800, color:"var(--accent)", marginBottom:16 }}>{fmt(total)}</div>
        {loading ? (
          <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted)" }}>Generando QR...</div>
        ) : qrUrl ? (
          <img src={qrUrl} alt="QR de pago" style={{ width:200, height:200, borderRadius:8, background:"#fff", padding:8 }} />
        ) : (
          <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--danger)", fontSize:12 }}>No se pudo generar el QR</div>
        )}
        <div style={{ fontSize:11, color:"var(--muted)", marginTop:12, marginBottom:16 }}>
          Muestre este código al cliente para que realice el pago
        </div>
        <button onClick={onClose}
          style={{ width:"100%", padding:"10px 0", background:"var(--accent)", border:"none", borderRadius:8, color:"#fff", fontWeight:700, cursor:"pointer" }}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

// ─── CobroModal ───────────────────────────────────────────────────────────────
function CobroModal({ total, clienteSeleccionado, onConfirm, onClose }) {
  const [pagos, setPagos] = useState([{ metodo: "efectivo", monto: "", efectivoStr: "" }]);
  const [puntosDisponibles, setPuntosDisponibles] = useState(0);
  const [puntosACanjear, setPuntosACanjear] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const [showGiftCardInput, setShowGiftCardInput] = useState(false);
  const [giftCards, setGiftCards] = useState([]); // [{codigo, saldo}] gift cards validadas
  const ef0Ref = useRef(null);
  const ef1Ref = useRef(null);

  useEffect(() => {
    if (clienteSeleccionado?.puntos_fidelizacion) {
      setPuntosDisponibles(Number(clienteSeleccionado.puntos_fidelizacion) || 0);
    }
  }, [clienteSeleccionado]);

  const valorPunto = 1; // $1 por punto
  const descuentoPuntos = Math.min(puntosACanjear * valorPunto, total * 0.3); // máx 30%
  const totalGiftCards = giftCards.reduce((s, gc) => s + gc.saldo, 0);
  const totalConPuntos  = Math.max(0, total - descuentoPuntos - totalGiftCards);

  const hayDos    = pagos.length === 2;
  const monto0    = parseFloat(pagos[0].monto) || 0;
  const monto1    = hayDos ? (parseFloat(pagos[1].monto) || 0) : 0;
  const sumPagado = monto0 + monto1;
  const resta     = totalConPuntos - sumPagado;

  const ef0 = pagos[0].metodo === "efectivo" ? (parseFloat(pagos[0].efectivoStr) || monto0) : 0;
  const ef1 = hayDos && pagos[1].metodo === "efectivo" ? (parseFloat(pagos[1].efectivoStr) || monto1) : 0;
  const vueltoEfectivo = Math.max(0,
    (ef0 - (pagos[0].metodo === "efectivo" ? monto0 : 0)) +
    (ef1 - (hayDos && pagos[1].metodo === "efectivo" ? monto1 : 0))
  );

  const tieneEfectivo  = pagos.some(p => p.metodo === "efectivo");
  const todosCubiertos = hayDos ? (sumPagado >= totalConPuntos && monto0 > 0 && monto1 > 0) : true;
  const puedeConfirmar = todosCubiertos;
  const tieneQR        = pagos.some(p => p.metodo === "qr" || p.metodo === "mercadopago");

  const agregarSegundo = () => {
    const resto = Math.max(0, totalConPuntos - monto0);
    setPagos(prev => [...prev, { metodo: "tarjeta_debito", monto: resto > 0 ? String(resto.toFixed(2)) : "", efectivoStr: "" }]);
  };
  const quitarSegundo = () => setPagos(prev => [prev[0]]);
  const updatePago    = (idx, field, val) => setPagos(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));

  const onMonto0Change = (val) => {
    updatePago(0, "monto", val);
    if (hayDos) {
      const m0 = parseFloat(val) || 0;
      const resto = Math.max(0, totalConPuntos - m0);
      updatePago(1, "monto", resto > 0 ? String(resto.toFixed(2)) : "");
    }
  };

  useEffect(() => {
    if (pagos[0].metodo === "efectivo") setTimeout(() => ef0Ref.current?.focus(), 80);
  }, []);

  useEffect(() => {
    let ready = false;
    const t = setTimeout(() => { ready = true; }, 200);
    const h = (e) => {
      if (!ready) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && puedeConfirmar) { handleConfirm(); }
    };
    window.addEventListener("keydown", h);
    return () => { clearTimeout(t); window.removeEventListener("keydown", h); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeConfirmar, pagos]);

  const handleConfirm = () => {
    const pagosPayload = pagos.map(p => ({
      metodo_pago: p.metodo,
      monto: parseFloat(p.monto) || (pagos.length === 1 ? totalConPuntos : 0),
    }));
    // Añadir gift cards como pagos adicionales
    for (const gc of giftCards) {
      pagosPayload.push({ metodo_pago: "gift_card", monto: gc.saldo, codigo: gc.codigo });
    }
    const pagoEfectivo = pagos.find(p => p.metodo === "efectivo");
    const efectivoRec  = pagoEfectivo ? (parseFloat(pagoEfectivo.efectivoStr) || parseFloat(pagoEfectivo.monto) || 0) : 0;
    onConfirm(pagosPayload, efectivoRec, vueltoEfectivo, Math.round(puntosACanjear), descuentoPuntos + totalGiftCards);
  };

  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:1, fontWeight:700, marginBottom:4 };

  return (
    <>
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ background:"var(--surface)", borderRadius:16, width:480, boxShadow:"0 24px 64px rgba(0,0,0,0.7)", overflow:"hidden" }}>

          {/* Header */}
          <div style={{ padding:"18px 22px 14px", borderBottom:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:13, color:"var(--muted)", textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>Cobrar venta</div>
              <div style={{ fontSize:28, fontWeight:800, fontFamily:"monospace", color:"var(--accent)", lineHeight:1.1, marginTop:2 }}>{fmt(totalConPuntos)}</div>
              {descuentoPuntos > 0 && (
                <div style={{ fontSize:11, color:"var(--success)", marginTop:2 }}>−{fmt(descuentoPuntos)} en puntos canjeados</div>
              )}
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {tieneQR && (
                <button onClick={() => setShowQR(true)}
                  style={{ padding:"6px 12px", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--accent)", fontSize:12, cursor:"pointer", fontWeight:600 }}>
                  Ver QR 📱
                </button>
              )}
              <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
            </div>
          </div>

          <div style={{ padding:"16px 22px", maxHeight:"72vh", overflowY:"auto" }}>

            {/* Puntos de fidelización */}
            {clienteSeleccionado && puntosDisponibles > 0 && (
              <div style={{ background:"rgba(72,187,120,0.08)", border:"1px solid rgba(72,187,120,0.2)", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
                <div style={lbl}>Puntos disponibles: {puntosDisponibles} pts (= {fmt(puntosDisponibles * valorPunto)})</div>
                <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:6 }}>
                  <input
                    type="number" min="0" max={puntosDisponibles}
                    value={puntosACanjear}
                    onChange={e => setPuntosACanjear(Math.min(Number(e.target.value), puntosDisponibles))}
                    placeholder="0"
                    style={{ width:80, background:"var(--bg)", border:"1px solid var(--border2)", borderRadius:6, padding:"6px 8px", color:"var(--text)", fontSize:13, outline:"none" }}
                  />
                  <span style={{ fontSize:12, color:"var(--success)" }}>puntos → −{fmt(descuentoPuntos)}</span>
                  {puntosACanjear > 0 && (
                    <button onClick={() => setPuntosACanjear(0)} style={{ background:"none", border:"none", color:"var(--danger)", cursor:"pointer", fontSize:14, padding:0 }}>✕</button>
                  )}
                </div>
              </div>
            )}

            {/* Gift Cards */}
            <div style={{ background:"rgba(var(--accent-rgb),0.06)", border:"1px solid rgba(var(--accent-rgb),0.2)", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: giftCards.length > 0 ? 8 : 0 }}>
                <div style={lbl}>🎁 Gift Cards</div>
                <button onClick={() => setShowGiftCardInput(true)}
                  style={{ padding:"4px 10px", background:"rgba(var(--accent-rgb),0.15)", border:"1px solid rgba(var(--accent-rgb),0.3)", borderRadius:6, color:"var(--accent)", cursor:"pointer", fontSize:11, fontWeight:700 }}>
                  + Canjear
                </button>
              </div>
              {giftCards.length > 0 ? (
                giftCards.map((gc, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, color:"var(--text)", marginTop:4 }}>
                    <span style={{ fontFamily:"monospace", color:"var(--accent)" }}>{gc.codigo}</span>
                    <span style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <span style={{ fontFamily:"monospace", fontWeight:700, color:"var(--success)" }}>{fmt(gc.saldo)}</span>
                      <button onClick={() => setGiftCards(prev => prev.filter((_, j) => j !== i))}
                        style={{ background:"none", border:"none", color:"var(--danger)", cursor:"pointer", fontSize:14, padding:0 }}>✕</button>
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize:11, color:"var(--muted)" }}>Sin gift cards aplicadas</div>
              )}
              {totalGiftCards > 0 && (
                <div style={{ fontSize:11, color:"var(--accent)", marginTop:6, fontWeight:700 }}>
                  Descuento gift cards: -{fmt(totalGiftCards)}
                </div>
              )}
            </div>

            {/* Pago 1 */}
            <div style={{ marginBottom:14 }}>
              <div style={lbl}>{hayDos ? "Pago 1" : "Método de pago"}</div>
              <MetodoSelectorPOS value={pagos[0].metodo} onChange={v => updatePago(0, "metodo", v)} excluir={hayDos ? [pagos[1].metodo] : []} />
              {hayDos && (
                <div style={{ marginTop:8 }}>
                  <div style={lbl}>Monto 1</div>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00"
                    value={pagos[0].monto} onChange={e => onMonto0Change(e.target.value)}
                    style={{ ...inputStyle, fontSize:18, fontFamily:"monospace", fontWeight:700, textAlign:"right" }} />
                </div>
              )}
              {pagos[0].metodo === "efectivo" && (
                <div style={{ marginTop:8 }}>
                  <div style={lbl}>Efectivo recibido</div>
                  <input ref={ef0Ref} type="number" min="0" step="0.01"
                    placeholder={fmt(hayDos ? (parseFloat(pagos[0].monto)||0) : totalConPuntos)}
                    value={pagos[0].efectivoStr} onChange={e => updatePago(0, "efectivoStr", e.target.value)}
                    style={{ ...inputStyle, fontSize:18, fontFamily:"monospace", fontWeight:700, textAlign:"right" }} />
                </div>
              )}
            </div>

            {/* Pago 2 */}
            {hayDos && (
              <div style={{ background:"var(--bg)", borderRadius:10, padding:"12px 14px", marginBottom:12, border:"1px solid var(--border2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={lbl}>Pago 2</div>
                  <button onClick={quitarSegundo} style={{ background:"none", border:"none", color:"var(--danger)", cursor:"pointer", fontSize:18, padding:0 }}>×</button>
                </div>
                <MetodoSelectorPOS value={pagos[1].metodo} onChange={v => updatePago(1, "metodo", v)} excluir={[pagos[0].metodo]} />
                <div style={{ marginTop:8 }}>
                  <div style={lbl}>Monto 2</div>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00"
                    value={pagos[1].monto} onChange={e => updatePago(1, "monto", e.target.value)}
                    style={{ ...inputStyle, fontSize:18, fontFamily:"monospace", fontWeight:700, textAlign:"right" }} />
                </div>
                {pagos[1].metodo === "efectivo" && (
                  <div style={{ marginTop:8 }}>
                    <div style={lbl}>Efectivo recibido (pago 2)</div>
                    <input ref={ef1Ref} type="number" min="0" step="0.01"
                      placeholder={fmt(parseFloat(pagos[1].monto)||0)}
                      value={pagos[1].efectivoStr} onChange={e => updatePago(1, "efectivoStr", e.target.value)}
                      style={{ ...inputStyle, fontSize:18, fontFamily:"monospace", fontWeight:700, textAlign:"right" }} />
                  </div>
                )}
              </div>
            )}

            {!hayDos && (
              <button onClick={agregarSegundo}
                style={{ width:"100%", padding:"9px 0", borderRadius:8, border:"1px dashed #444",
                  background:"transparent", color:"var(--muted)", cursor:"pointer", fontSize:13, fontWeight:600, marginBottom:12 }}>
                + Agregar segundo método de pago
              </button>
            )}

            {/* Resumen */}
            <div style={{ borderTop:"1px solid var(--border2)", paddingTop:12 }}>
              {hayDos && (
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:13, color:"var(--muted)" }}>Total cobrado</span>
                  <span style={{ fontSize:14, fontFamily:"monospace", fontWeight:700,
                    color: sumPagado >= totalConPuntos ? "var(--success)" : "var(--danger)" }}>{fmt(sumPagado)}</span>
                </div>
              )}
              {hayDos && resta !== 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:13, color: resta > 0 ? "var(--danger)" : "var(--muted)" }}>{resta > 0 ? "Resta" : "Exceso"}</span>
                  <span style={{ fontSize:14, fontFamily:"monospace", fontWeight:700,
                    color: resta > 0 ? "var(--danger)" : "var(--muted)" }}>{fmt(Math.abs(resta))}</span>
                </div>
              )}
              {tieneEfectivo && vueltoEfectivo > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"8px 12px", borderRadius:8, background:"rgba(72,187,120,0.12)", marginTop:4 }}>
                  <span style={{ fontSize:13, color:"var(--success)", fontWeight:600 }}>Vuelto (efectivo)</span>
                  <span style={{ fontSize:20, fontFamily:"monospace", fontWeight:700, color:"var(--success)" }}>{fmt(vueltoEfectivo)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Botones */}
          <div style={{ padding:"12px 22px 20px", display:"flex", gap:10, borderTop:"1px solid var(--border2)" }}>
            <button onClick={onClose}
              style={{ flex:1, padding:"10px 0", borderRadius:8, border:"1px solid var(--border2)", background:"var(--bg)", color:"var(--muted2)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
              Cancelar
            </button>
            <button onClick={() => puedeConfirmar && handleConfirm()}
              style={{ flex:2, padding:"10px 0", borderRadius:8, border:"none",
                background: puedeConfirmar ? "#7c3aed" : "#3d3d5c",
                color:"#fff", fontWeight:800, fontSize:15, cursor: puedeConfirmar ? "pointer" : "not-allowed",
                opacity: puedeConfirmar ? 1 : 0.45 }}>
              Confirmar cobro ↵
            </button>
          </div>
        </div>
      </div>
      {showQR && (
        <QRModal total={totalConPuntos} metodo={pagos[0].metodo} onClose={() => setShowQR(false)} />
      )}
      {showGiftCardInput && (
        <GiftCardModal
          onValidar={(saldo, codigo) => {
            setGiftCards(prev => {
              if (prev.find(gc => gc.codigo === codigo)) {
                toast("Esta gift card ya fue añadida");
                return prev;
              }
              return [...prev, { codigo, saldo }];
            });
          }}
          onClose={() => setShowGiftCardInput(false)}
        />
      )}
    </>
  );
}

// ─── TicketModal ──────────────────────────────────────────────────────────────
function TicketModal({ ticket, onImprimir, onClose }) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "p" || e.key === "P") onImprimir();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onImprimir]);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{ background:"var(--surface)", borderRadius:14, padding:28, width:400, boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:32 }}>{ticket.offline ? "📴" : "✅"}</div>
          <div style={{ fontWeight:700, fontSize:16, marginTop:8 }}>
            {ticket.offline ? "Venta guardada offline" : "Venta procesada"}
          </div>
          <div style={{ fontSize:13, color:"var(--muted2)", fontFamily:"monospace", marginTop:4 }}>{ticket.numero}</div>
          {ticket.offline && (
            <div style={{ fontSize:11, color:"#e8a923", marginTop:6 }}>Se sincronizará cuando se recupere la conexión</div>
          )}
        </div>
        <div style={{ fontFamily:"monospace", fontSize:12, background:"var(--bg)", borderRadius:8, padding:12, marginBottom:16, maxHeight:160, overflowY:"auto" }}>
          {ticket.items.map((item, i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span>{item.nombre} x{item.cantidad}</span>
              <span>{fmt(item.subtotal)}</span>
            </div>
          ))}
          {ticket.descuento > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", color:"#e8a923" }}>
              <span>Descuento</span><span>-{fmt(ticket.descuento)}</span>
            </div>
          )}
          {ticket.puntosCanjeados > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", color:"var(--success)" }}>
              <span>Puntos ({ticket.puntosCanjeados}pts)</span><span>-{fmt(ticket.puntosCanjeados)}</span>
            </div>
          )}
          <div style={{ borderTop:"1px solid var(--border2)", marginTop:8, paddingTop:8, display:"flex", justifyContent:"space-between", fontWeight:700, color:"var(--accent)", fontSize:14 }}>
            <span>TOTAL</span><span>{fmt(ticket.total)}</span>
          </div>
          {ticket.vuelto > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", color:"var(--success)", marginTop:4 }}>
              <span>Vuelto</span><span>{fmt(ticket.vuelto)}</span>
            </div>
          )}
          {ticket.puntosGanados > 0 && (
            <div style={{ color:"var(--success)", marginTop:6, fontSize:11 }}>+{ticket.puntosGanados} puntos ganados</div>
          )}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onImprimir} style={{ ...btnStyle, background:"var(--border2)" }}>
            🖨️ Imprimir (P)
          </button>
          <button onClick={onClose} style={{ ...btnStyle, background:"#7c3aed" }}>
            Continuar ↵
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SupervisorModal ──────────────────────────────────────────────────────────
function SupervisorModal({ onAuth, onClose }) {
  const [pin, setPin]       = useState("");
  const [err, setErr]       = useState(false);
  const [loading, setLoading] = useState(false);

  // Bug #1 fix: leer PIN de config guardada, NO hardcodeado
  const tryAuth = async () => {
    if (loading) return;
    setLoading(true);
    try {
      let savedPin = "1234"; // fallback por defecto
      if (isElectronRuntime()) {
        const cfg = await getRuntimeConfig();
        savedPin = cfg.supervisor_pin || savedPin;
      } else {
        savedPin = localStorage.getItem("pos_supervisor_pin") || savedPin;
      }
      if (pin === savedPin) {
        onAuth();
      } else {
        setErr(true);
        setPin("");
        setTimeout(() => setErr(false), 1500);
      }
    } catch {
      setErr(true);
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "Enter")     { tryAuth(); return; }
      if (e.key === "Escape")    { onClose(); return; }
      if (/^\d$/.test(e.key) && pin.length < 6) setPin(v => v + e.key);
      if (e.key === "Backspace") setPin(v => v.slice(0, -1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{ background:"var(--surface)", borderRadius:14, padding:32, width:300, textAlign:"center" }}>
        <div style={{ fontSize:32, marginBottom:8 }}>🔐</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Acceso Supervisor</div>
        <div style={{ fontSize:12, color:"var(--muted2)", marginBottom:20 }}>Ingrese el PIN de supervisor</div>
        <div style={{ fontSize:28, letterSpacing:12, color: err ? "var(--danger)" : "var(--accent)", fontFamily:"monospace", padding:"10px 0", marginBottom:20 }}>
          {"●".repeat(pin.length) || "—"}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
            <button key={i} onClick={() => {
              if (!k) return;
              if (k === "⌫") setPin(v => v.slice(0, -1));
              else if (pin.length < 6) setPin(v => v + k);
            }} style={{
              padding:"13px 0", borderRadius:8, border:"none", cursor: k ? "pointer" : "default",
              background: k ? "var(--border2)" : "transparent", color:"var(--text)", fontWeight:600, fontSize:16,
            }}>{k}</button>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={btnStyle}>Cancelar</button>
          <button onClick={tryAuth} disabled={loading} style={{ ...btnStyle, background:"#7c3aed" }}>
            {loading ? "..." : "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ParkModal — Guardar/retomar ventas en espera ─────────────────────────────
function ParkModal({ cart, clienteId, clienteNombre, onResume, onClose }) {
  const [parked, setParked] = useState([]);
  const [nombre, setNombre] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getParkedCarts().then(p => { setParked(p); setLoading(false); });
  }, []);

  const handlePark = async () => {
    if (cart.length === 0) { toast("El carrito está vacío"); onClose(); return; }
    const n = nombre.trim() || (clienteNombre && clienteNombre !== "Consumidor Final" ? clienteNombre : `Venta ${new Date().toLocaleTimeString("es-AR")}`);
    await parkCart(n, { cart, clienteId, clienteNombre });
    toast.success("Venta guardada en espera");
    onClose();
  };

  const handleResume = async (item) => {
    await removeParkedCart(item.park_id);
    onResume(item);
    onClose();
  };

  const handleDelete = async (park_id) => {
    await removeParkedCart(park_id);
    setParked(prev => prev.filter(p => p.park_id !== park_id));
    toast("Venta en espera eliminada");
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, width:500, maxHeight:"80vh", boxShadow:"0 24px 64px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:700, fontSize:15 }}>⏸ Ventas en Espera</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {cart.length > 0 && (
            <div style={{ background:"var(--bg)", borderRadius:10, padding:14, marginBottom:14, border:"1px solid var(--border2)" }}>
              <div style={{ fontSize:12, color:"var(--muted2)", marginBottom:8, fontWeight:600 }}>
                Guardar carrito actual ({cart.length} producto{cart.length !== 1 ? "s" : ""})
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <input
                  value={nombre} onChange={e => setNombre(e.target.value)}
                  placeholder={`Nombre (ej: Mesa 3${clienteNombre ? `, ${clienteNombre}` : ""})`}
                  style={{ flex:1, background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:8, padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none" }}
                />
                <button onClick={handlePark}
                  style={{ padding:"8px 16px", background:"#e8a923", border:"none", borderRadius:8, color:"#000", fontWeight:700, cursor:"pointer", fontSize:13, whiteSpace:"nowrap" }}>
                  Guardar ⏸
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:8 }}>VENTAS EN ESPERA</div>
          {loading ? (
            <div style={{ color:"#555", fontSize:13, textAlign:"center", padding:20 }}>Cargando...</div>
          ) : parked.length === 0 ? (
            <div style={{ color:"#555", fontSize:13, textAlign:"center", padding:20 }}>No hay ventas en espera</div>
          ) : parked.map(item => (
            <div key={item.park_id} style={{ background:"var(--bg)", borderRadius:10, padding:"12px 14px", marginBottom:8, border:"1px solid var(--border2)", display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {item.nombre || "Venta sin nombre"}
                </div>
                <div style={{ fontSize:11, color:"var(--muted2)" }}>
                  {item.cart?.length || 0} prod · {new Date(item.created_at).toLocaleTimeString("es-AR")}
                </div>
              </div>
              <button onClick={() => handleResume(item)}
                style={{ padding:"6px 14px", background:"#7c3aed", border:"none", borderRadius:8, color:"#fff", fontWeight:700, cursor:"pointer", fontSize:12 }}>
                Retomar ▶
              </button>
              <button onClick={() => handleDelete(item.park_id)}
                style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:18, padding:2 }}>✕</button>
            </div>
          ))}
        </div>

        <div style={{ padding:"12px 16px", borderTop:"1px solid var(--border2)" }}>
          <button onClick={onClose} style={{ width:"100%", padding:"9px 0", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── HistorialModal — Ventas del turno + anulación + reimpresión ──────────────
function HistorialModal({ sucursalActual, turnoId, posConfig, onClose }) {
  const [ventas, setVentas]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [anulando, setAnulando] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = { sucursal_id: sucursalActual, limit: 50 };
      if (turnoId) params.turno_id = turnoId;
      const { data } = await api.get("/pos/ventas-turno", { params });
      setVentas(Array.isArray(data) ? data : (data?.data || []));
    } catch {
      // Fallback: intentar endpoint general de ventas
      try {
        const { data } = await api.get("/ventas", { params: { sucursal_id: sucursalActual, limit: 20 } });
        setVentas(Array.isArray(data) ? data : (data?.data || []));
      } catch {
        toast.error("Error al cargar historial");
      }
    } finally {
      setLoading(false);
    }
  }, [sucursalActual, turnoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleAnular = async (venta) => {
    if (!window.confirm(`¿Anular venta ${venta.numero}? Esta acción no se puede deshacer.`)) return;
    setAnulando(venta.id);
    try {
      await api.post(`/ventas/${venta.id}/anular`, { motivo: "Anulado desde POS" });
      toast.success(`Venta ${venta.numero} anulada`);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al anular");
    } finally {
      setAnulando(null);
    }
  };

  const handleReimprimir = (venta) => {
    const ticketData = {
      numero:         venta.numero,
      total:          venta.total,
      descuento:      venta.descuento || 0,
      cliente_nombre: venta.cliente_nombre || "Consumidor Final",
      nota:           venta.nota || "",
      vuelto:         0,
      puntosGanados:  0,
      puntosCanjeados: 0,
      pagos:          venta.pagos || [{ metodo_pago: venta.metodo_pago || "efectivo", monto: venta.total }],
      items:          (venta.items || []).map(i => ({
        nombre:      i.nombre || i.producto_nombre || "Producto",
        cantidad:    i.cantidad,
        precio_unit: i.precio_unit,
        subtotal:    i.subtotal || i.precio_unit * i.cantidad,
      })),
      offline: false,
    };
    const html = generarHTMLTicket(ticketData, posConfig);
    imprimirHTML(html, posConfig);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, width:660, maxHeight:"85vh", boxShadow:"0 24px 64px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:700, fontSize:15 }}>📋 Historial del Turno</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={cargar} style={{ padding:"5px 10px", background:"var(--border2)", border:"none", borderRadius:6, color:"var(--muted2)", cursor:"pointer", fontSize:12 }}>↻ Actualizar</button>
            <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {loading ? (
            <div style={{ color:"#555", fontSize:13, textAlign:"center", padding:30 }}>Cargando...</div>
          ) : ventas.length === 0 ? (
            <div style={{ color:"#555", fontSize:13, textAlign:"center", padding:30 }}>No hay ventas registradas</div>
          ) : ventas.map(v => (
            <div key={v.id} style={{
              background:"var(--bg)", borderRadius:10, padding:"11px 14px", marginBottom:8,
              border:`1px solid ${v.estado === "anulada" ? "rgba(229,62,62,0.3)" : "var(--border2)"}`,
              display:"flex", alignItems:"center", gap:10,
            }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontWeight:700, fontSize:13, fontFamily:"monospace" }}>{v.numero}</span>
                  {v.estado === "anulada" && (
                    <span style={{ fontSize:10, color:"var(--danger)", background:"rgba(229,62,62,0.15)", padding:"1px 6px", borderRadius:4, fontWeight:700 }}>ANULADA</span>
                  )}
                </div>
                <div style={{ fontSize:11, color:"var(--muted2)", marginTop:2 }}>
                  {v.cliente_nombre || "Consumidor Final"} · {v.metodo_pago || "-"} · {new Date(v.created_at).toLocaleTimeString("es-AR")}
                </div>
              </div>
              <div style={{ fontFamily:"monospace", fontWeight:700, color:"var(--accent)", fontSize:14 }}>{fmt(v.total)}</div>
              <button onClick={() => handleReimprimir(v)} title="Reimprimir ticket"
                style={{ padding:"5px 10px", background:"var(--border2)", border:"none", borderRadius:6, color:"var(--muted2)", cursor:"pointer", fontSize:14 }}>
                🖨️
              </button>
              {v.estado !== "anulada" && (
                <button onClick={() => handleAnular(v)} disabled={anulando === v.id} title="Anular venta"
                  style={{ padding:"5px 10px", background:"rgba(229,62,62,0.1)", border:"1px solid rgba(229,62,62,0.3)", borderRadius:6, color:"var(--danger)", cursor:"pointer", fontSize:12, fontWeight:600 }}>
                  {anulando === v.id ? "..." : "Anular"}
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding:"12px 16px", borderTop:"1px solid var(--border2)" }}>
          <button onClick={onClose} style={{ width:"100%", padding:"9px 0", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FavoritosPanel — acceso rápido a productos frecuentes ───────────────────
function FavoritosPanel({ sucursalActual, onAdd, show, onToggle }) {
  const [favoritos, setFavoritos] = useState([]);

  const recargar = useCallback(async () => {
    if (!sucursalActual) return;
    const favs = await getFavoritos(sucursalActual);
    setFavoritos(favs.sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at)));
  }, [sucursalActual]);

  useEffect(() => {
    if (show) recargar();
  }, [show, recargar]);

  const handleRemove = async (producto_id, e) => {
    e.stopPropagation();
    await removeFavorito(producto_id);
    setFavoritos(prev => prev.filter(f => f.producto_id !== producto_id));
    toast("Eliminado de favoritos");
  };

  if (!show) return null;

  return (
    <div style={{ padding:"0 14px 10px", borderBottom:"1px solid var(--border2)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontSize:10, color:"#e8a923", fontWeight:700, letterSpacing:1 }}>⭐ FAVORITOS / ACCESO RÁPIDO</div>
        <button onClick={onToggle} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:11, padding:0 }}>Ocultar</button>
      </div>
      {favoritos.length === 0 ? (
        <div style={{ fontSize:11, color:"#555", textAlign:"center", padding:"8px 0" }}>
          Mantén presionado un producto en la búsqueda para fijarlo aquí
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(100px, 1fr))", gap:6 }}>
          {favoritos.map(fav => (
            <div key={fav.producto_id} style={{ position:"relative" }}>
              <button
                onClick={() => onAdd({ id: fav.producto_id, nombre: fav.nombre, precio: fav.precio, stock: fav.stock ?? 999, codigo_barras: fav.codigo_barras })}
                style={{
                  width:"100%", padding:"7px 6px", background:"rgba(var(--accent-rgb),0.08)", border:"1px solid rgba(var(--accent-rgb),0.25)",
                  borderRadius:8, color:"var(--text)", cursor:"pointer", textAlign:"center",
                  fontSize:11, lineHeight:1.2,
                }}>
                <div style={{ fontSize:15, marginBottom:2 }}>⭐</div>
                <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:600 }}>{fav.nombre}</div>
                <div style={{ fontFamily:"monospace", fontSize:10, color:"var(--accent)", marginTop:1 }}>{fmt(fav.precio)}</div>
              </button>
              <button
                onClick={(e) => handleRemove(fav.producto_id, e)}
                style={{ position:"absolute", top:2, right:2, background:"rgba(0,0,0,0.5)", border:"none", borderRadius:"50%", color:"var(--muted2)", cursor:"pointer", fontSize:10, width:14, height:14, lineHeight:"14px", padding:0, textAlign:"center" }}
                title="Quitar de favoritos">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ClienteHistorialModal — historial de compras del cliente seleccionado ────
function ClienteHistorialModal({ cliente, onClose }) {
  const [ventas, setVentas]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandido, setExpandido] = useState(null);

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/clientes/${cliente.id}/ventas`, { params: { limit: 30 } });
        setVentas(Array.isArray(data) ? data : (data?.data || []));
      } catch {
        try {
          const { data } = await api.get("/ventas", { params: { cliente_id: cliente.id, limit: 30 } });
          setVentas(Array.isArray(data) ? data : (data?.data || []));
        } catch {
          toast.error("No se pudo cargar el historial");
        }
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [cliente.id]);

  const totalComprado = ventas.filter(v => v.estado !== "anulada").reduce((s, v) => s + Number(v.total || 0), 0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, width:580, maxHeight:"82vh", boxShadow:"0 24px 64px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>🛍 Historial de {cliente.nombre}</div>
            <div style={{ fontSize:11, color:"var(--muted2)", marginTop:2 }}>
              {ventas.length} compras · Total acumulado: <span style={{ color:"var(--accent)", fontFamily:"monospace" }}>{fmt(totalComprado)}</span>
              {(cliente.puntos_fidelizacion || 0) > 0 && (
                <span style={{ marginLeft:8, color:"var(--success)" }}>· ★ {cliente.puntos_fidelizacion} pts</span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {loading ? (
            <div style={{ color:"#555", textAlign:"center", padding:30 }}>Cargando historial...</div>
          ) : ventas.length === 0 ? (
            <div style={{ color:"#555", textAlign:"center", padding:30, fontSize:13 }}>No hay compras registradas para este cliente</div>
          ) : ventas.map(v => (
            <div key={v.id} style={{
              background:"var(--bg)", borderRadius:10, marginBottom:8,
              border:`1px solid ${v.estado === "anulada" ? "rgba(229,62,62,0.25)" : "var(--border2)"}`,
              overflow:"hidden",
            }}>
              <div
                onClick={() => setExpandido(expandido === v.id ? null : v.id)}
                style={{ padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontFamily:"monospace", fontWeight:700, fontSize:13 }}>{v.numero}</span>
                    {v.estado === "anulada" && (
                      <span style={{ fontSize:10, color:"var(--danger)", background:"rgba(229,62,62,0.12)", padding:"1px 5px", borderRadius:4, fontWeight:700 }}>ANULADA</span>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:"var(--muted2)", marginTop:1 }}>
                    {new Date(v.created_at).toLocaleDateString("es-AR")} · {v.metodo_pago || "efectivo"}
                  </div>
                </div>
                <div style={{ fontFamily:"monospace", fontWeight:700, color:"var(--accent)" }}>{fmt(v.total)}</div>
                <span style={{ fontSize:12, color:"#555" }}>{expandido === v.id ? "▲" : "▼"}</span>
              </div>
              {expandido === v.id && (v.items?.length > 0) && (
                <div style={{ borderTop:"1px solid var(--border2)", padding:"8px 14px" }}>
                  {v.items.map((it, i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--muted2)", marginBottom:3 }}>
                      <span>{it.nombre || it.producto_nombre || "Producto"} x{it.cantidad}</span>
                      <span style={{ fontFamily:"monospace" }}>{fmt((it.subtotal || it.precio_unit * it.cantidad) || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding:"12px 16px", borderTop:"1px solid var(--border2)" }}>
          <button onClick={onClose} style={{ width:"100%", padding:"9px 0", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DevolucionModal — procesar devoluciones desde el POS ─────────────────────
function DevolucionModal({ sucursalActual, onClose }) {
  const [nroVenta, setNroVenta]   = useState("");
  const [venta, setVenta]         = useState(null);
  const [items, setItems]         = useState([]);
  const [motivo, setMotivo]       = useState("Devolución de cliente");
  const [buscando, setBuscando]   = useState(false);
  const [procesando, setProcesando] = useState(false);

  const buscarVenta = async () => {
    if (!nroVenta.trim()) return;
    setBuscando(true);
    try {
      const { data } = await api.get("/ventas", { params: { numero: nroVenta.trim(), sucursal_id: sucursalActual } });
      const lista = Array.isArray(data) ? data : (data?.data || []);
      const v = lista[0];
      if (!v) { toast.error("Venta no encontrada"); return; }
      if (v.estado === "anulada") { toast.error("La venta ya fue anulada"); return; }
      setVenta(v);
      setItems((v.items || []).map(it => ({
        ...it,
        nombre: it.nombre || it.producto_nombre || "Producto",
        devolver: 0,
        max: it.cantidad,
      })));
    } catch {
      toast.error("Error al buscar la venta");
    } finally {
      setBuscando(false);
    }
  };

  const setDevolver = (idx, val) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, devolver: Math.min(Math.max(0, Number(val)), it.max) } : it));
  };

  const totalDevolucion = items.reduce((s, it) => s + (it.devolver * (it.precio_unit || 0)), 0);
  const hayItems = items.some(it => it.devolver > 0);

  const confirmar = async () => {
    if (!hayItems) { toast.error("Seleccione al menos un ítem a devolver"); return; }
    if (!window.confirm(`¿Confirmar devolución por ${fmt(totalDevolucion)}?`)) return;
    setProcesando(true);
    try {
      const itemsDevolver = items.filter(it => it.devolver > 0).map(it => ({
        producto_id: it.producto_id,
        cantidad: it.devolver,
        precio_unit: it.precio_unit,
      }));
      await api.post("/devoluciones", {
        venta_id:    venta.id,
        sucursal_id: sucursalActual,
        motivo,
        items: itemsDevolver,
      });
      toast.success(`Devolución registrada: ${fmt(totalDevolucion)}`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al procesar devolución");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, width:540, maxHeight:"85vh", boxShadow:"0 24px 64px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:700, fontSize:15 }}>↩ Devolución</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {/* Buscar venta */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:6 }}>NÚMERO DE VENTA</div>
            <div style={{ display:"flex", gap:8 }}>
              <input
                value={nroVenta}
                onChange={e => setNroVenta(e.target.value)}
                onKeyDown={e => e.key === "Enter" && buscarVenta()}
                placeholder="Ej: V-0001234"
                style={{ flex:1, background:"var(--bg)", border:"1px solid var(--border2)", borderRadius:8, padding:"9px 12px", color:"var(--text)", fontSize:13, outline:"none" }}
              />
              <button onClick={buscarVenta} disabled={buscando}
                style={{ padding:"9px 16px", background:"#7c3aed", border:"none", borderRadius:8, color:"#fff", fontWeight:700, cursor:"pointer", fontSize:13 }}>
                {buscando ? "..." : "Buscar"}
              </button>
            </div>
          </div>

          {venta && (
            <>
              <div style={{ background:"var(--bg)", borderRadius:10, padding:"10px 14px", marginBottom:14, border:"1px solid var(--border2)" }}>
                <div style={{ fontSize:11, color:"var(--muted2)" }}>
                  <span style={{ fontFamily:"monospace", fontWeight:700, color:"var(--text)" }}>{venta.numero}</span>
                  {" · "}{new Date(venta.created_at).toLocaleDateString("es-AR")}
                  {" · "}{venta.cliente_nombre || "Consumidor Final"}
                </div>
                <div style={{ fontFamily:"monospace", fontWeight:700, color:"var(--accent)", marginTop:3 }}>Total: {fmt(venta.total)}</div>
              </div>

              <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:8 }}>SELECCIONE ÍTEMS A DEVOLVER</div>
              {items.map((it, idx) => (
                <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:"var(--bg)", borderRadius:8, marginBottom:6, border:"1px solid var(--border2)" }}>
                  <div style={{ flex:1, fontSize:12 }}>
                    <div style={{ fontWeight:600 }}>{it.nombre}</div>
                    <div style={{ color:"var(--muted2)", fontSize:11 }}>{it.cantidad} unidades · {fmt(it.precio_unit)} c/u</div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <button onClick={() => setDevolver(idx, it.devolver - 1)} style={{ width:22, height:22, background:"var(--surface3)", border:"none", borderRadius:4, color:"#fff", cursor:"pointer", fontWeight:700, fontSize:14 }}>−</button>
                    <input type="number" min="0" max={it.max} value={it.devolver}
                      onChange={e => setDevolver(idx, e.target.value)}
                      style={{ width:40, textAlign:"center", background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:6, padding:"3px 0", color:"var(--accent)", fontFamily:"monospace", fontWeight:700, fontSize:13, outline:"none" }} />
                    <button onClick={() => setDevolver(idx, it.devolver + 1)} style={{ width:22, height:22, background:"var(--surface3)", border:"none", borderRadius:4, color:"#fff", cursor:"pointer", fontWeight:700, fontSize:14 }}>+</button>
                  </div>
                  <div style={{ fontFamily:"monospace", fontSize:12, color:"var(--accent)", minWidth:56, textAlign:"right" }}>{fmt(it.devolver * it.precio_unit)}</div>
                </div>
              ))}

              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:6 }}>MOTIVO</div>
                <input
                  value={motivo} onChange={e => setMotivo(e.target.value)}
                  style={{ width:"100%", background:"var(--bg)", border:"1px solid var(--border2)", borderRadius:8, padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>

              {totalDevolucion > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:14, padding:"10px 14px", background:"rgba(229,62,62,0.08)", borderRadius:8, border:"1px solid rgba(229,62,62,0.2)" }}>
                  <span style={{ fontWeight:700 }}>Total a devolver</span>
                  <span style={{ fontFamily:"monospace", fontWeight:800, fontSize:16, color:"var(--danger)" }}>{fmt(totalDevolucion)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding:"12px 16px", borderTop:"1px solid var(--border2)", display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:"9px 0", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            Cancelar
          </button>
          {venta && (
            <button onClick={confirmar} disabled={!hayItems || procesando}
              style={{ flex:2, padding:"9px 0", background: hayItems ? "var(--danger)" : "#3d3d5c", border:"none", borderRadius:8, color:"#fff", fontWeight:700, cursor: hayItems ? "pointer" : "not-allowed", fontSize:13, opacity: hayItems ? 1 : 0.5 }}>
              {procesando ? "Procesando..." : `↩ Confirmar devolución`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── GiftCardModal — validar y canjear gift card ──────────────────────────────
function GiftCardModal({ onValidar, onClose }) {
  const [codigo, setCodigo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const validar = async () => {
    if (!codigo.trim()) return;
    setLoading(true);
    setResultado(null);
    try {
      const { data } = await api.post("/pos/gift-card/validar", { codigo: codigo.trim() });
      setResultado(data);
    } catch (err) {
      const msg = err.response?.data?.error || "Código inválido o gift card sin saldo";
      setResultado({ error: msg, saldo: 0 });
    } finally {
      setLoading(false);
    }
  };

  const confirmar = () => {
    if (!resultado || resultado.error) return;
    onValidar(resultado.saldo, codigo.trim(), resultado);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10001 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:14, padding:28, width:360, boxShadow:"0 20px 60px rgba(0,0,0,0.7)" }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontSize:32 }}>🎁</div>
          <div style={{ fontWeight:700, fontSize:16, marginTop:6 }}>Canjear Gift Card</div>
        </div>
        <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:6 }}>CÓDIGO DE GIFT CARD</div>
        <input ref={inputRef}
          value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && validar()}
          placeholder="Ej: GC-XXXXXX"
          style={{ width:"100%", background:"var(--bg)", border:`1px solid ${resultado?.error ? "var(--danger)" : "var(--border2)"}`, borderRadius:8, padding:"10px 12px", color:"var(--accent)", fontSize:15, fontFamily:"monospace", letterSpacing:2, outline:"none", boxSizing:"border-box", textTransform:"uppercase" }}
        />

        {resultado && (
          <div style={{ marginTop:12, padding:"10px 12px", borderRadius:8,
            background: resultado.error ? "rgba(229,62,62,0.08)" : "rgba(72,187,120,0.08)",
            border: `1px solid ${resultado.error ? "rgba(229,62,62,0.25)" : "rgba(72,187,120,0.25)"}` }}>
            {resultado.error ? (
              <div style={{ color:"var(--danger)", fontSize:13 }}>✕ {resultado.error}</div>
            ) : (
              <div>
                <div style={{ color:"var(--success)", fontSize:13, fontWeight:600 }}>✓ Gift card válida</div>
                <div style={{ fontSize:12, color:"var(--muted2)", marginTop:4 }}>
                  Saldo disponible: <span style={{ color:"var(--accent)", fontFamily:"monospace", fontWeight:700 }}>{fmt(resultado.saldo)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button onClick={onClose} style={{ flex:1, padding:"9px 0", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            Cancelar
          </button>
          {!resultado || resultado.error ? (
            <button onClick={validar} disabled={loading || !codigo.trim()}
              style={{ flex:2, padding:"9px 0", background: codigo.trim() ? "#7c3aed" : "#3d3d5c", border:"none", borderRadius:8, color:"#fff", fontWeight:700, cursor: codigo.trim() ? "pointer" : "not-allowed", fontSize:13 }}>
              {loading ? "Validando..." : "Validar"}
            </button>
          ) : (
            <button onClick={confirmar}
              style={{ flex:2, padding:"9px 0", background:"var(--success)", border:"none", borderRadius:8, color:"#000", fontWeight:800, cursor:"pointer", fontSize:13 }}>
              Usar {fmt(resultado.saldo)} ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ResumenDiaModal — resumen del día con totales por método de pago ─────────
function ResumenDiaModal({ sucursalActual, onClose }) {
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/ventas/resumen-dia", { params: { sucursal_id: sucursalActual } });
        setResumen(data);
      } catch {
        // Fallback: calcular desde /ventas del día
        try {
          const hoy = new Date().toISOString().slice(0, 10);
          const { data } = await api.get("/ventas", { params: { sucursal_id: sucursalActual, fecha_desde: hoy, limit: 500 } });
          const lista = Array.isArray(data) ? data : (data?.data || []);
          const activas = lista.filter(v => v.estado !== "anulada");
          const byMetodo = {};
          for (const v of activas) {
            const m = v.metodo_pago || "efectivo";
            byMetodo[m] = (byMetodo[m] || 0) + Number(v.total || 0);
          }
          setResumen({
            total_dia: activas.reduce((s, v) => s + Number(v.total || 0), 0),
            cantidad_ventas: activas.length,
            por_metodo: byMetodo,
            ticket_promedio: activas.length > 0
              ? activas.reduce((s, v) => s + Number(v.total || 0), 0) / activas.length
              : 0,
          });
        } catch {
          toast.error("No se pudo cargar el resumen del día");
        }
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [sucursalActual]);

  const metodoIconos = { efectivo:"💵", tarjeta_debito:"💳", tarjeta_credito:"💳", transferencia:"🏦", qr:"📱", mercadopago:"🔵", gift_card:"🎁" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, width:440, maxHeight:"80vh", boxShadow:"0 24px 64px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>📊 Resumen del Día</div>
            <div style={{ fontSize:11, color:"var(--muted2)", marginTop:1 }}>{new Date().toLocaleDateString("es-AR", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:20 }}>
          {loading ? (
            <div style={{ color:"#555", textAlign:"center", padding:40 }}>Cargando...</div>
          ) : !resumen ? (
            <div style={{ color:"#555", textAlign:"center", padding:40 }}>No hay datos</div>
          ) : (
            <>
              {/* KPIs principales */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
                <div style={{ background:"var(--bg)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border2)" }}>
                  <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:4 }}>TOTAL DEL DÍA</div>
                  <div style={{ fontFamily:"monospace", fontWeight:800, fontSize:22, color:"var(--accent)" }}>{fmt(resumen.total_dia || 0)}</div>
                </div>
                <div style={{ background:"var(--bg)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border2)" }}>
                  <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:4 }}>VENTAS</div>
                  <div style={{ fontFamily:"monospace", fontWeight:800, fontSize:22, color:"var(--success)" }}>{resumen.cantidad_ventas || 0}</div>
                </div>
                <div style={{ background:"var(--bg)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border2)" }}>
                  <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:4 }}>TICKET PROMEDIO</div>
                  <div style={{ fontFamily:"monospace", fontWeight:800, fontSize:18, color:"var(--text)" }}>{fmt(resumen.ticket_promedio || 0)}</div>
                </div>
                {resumen.total_descuentos > 0 && (
                  <div style={{ background:"var(--bg)", borderRadius:10, padding:"14px 16px", border:"1px solid var(--border2)" }}>
                    <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:4 }}>DESCUENTOS</div>
                    <div style={{ fontFamily:"monospace", fontWeight:800, fontSize:18, color:"#e8a923" }}>-{fmt(resumen.total_descuentos)}</div>
                  </div>
                )}
              </div>

              {/* Por método de pago */}
              <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:1, marginBottom:10 }}>POR MÉTODO DE PAGO</div>
              {resumen.por_metodo && Object.entries(resumen.por_metodo)
                .sort(([,a], [,b]) => b - a)
                .map(([metodo, monto]) => (
                  <div key={metodo} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                    <span style={{ fontSize:14 }}>{metodoIconos[metodo] || "💰"}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, color:"var(--text)", textTransform:"capitalize" }}>
                        {metodo.replace(/_/g, " ")}
                      </div>
                      <div style={{ height:4, background:"var(--border2)", borderRadius:2, marginTop:3, overflow:"hidden" }}>
                        <div style={{
                          height:"100%", borderRadius:2,
                          background:"var(--accent)",
                          width: `${resumen.total_dia > 0 ? Math.round((monto / resumen.total_dia) * 100) : 0}%`,
                        }} />
                      </div>
                    </div>
                    <div style={{ fontFamily:"monospace", fontWeight:700, fontSize:13, color:"var(--accent)", minWidth:80, textAlign:"right" }}>{fmt(monto)}</div>
                    <div style={{ fontSize:11, color:"#555", minWidth:32, textAlign:"right" }}>
                      {resumen.total_dia > 0 ? Math.round((monto / resumen.total_dia) * 100) : 0}%
                    </div>
                  </div>
                ))}

              {/* Anulaciones */}
              {(resumen.ventas_anuladas || 0) > 0 && (
                <div style={{ marginTop:16, padding:"8px 12px", borderRadius:8, background:"rgba(229,62,62,0.06)", border:"1px solid rgba(229,62,62,0.15)", fontSize:12, color:"var(--danger)" }}>
                  {resumen.ventas_anuladas} venta{resumen.ventas_anuladas !== 1 ? "s" : ""} anulada{resumen.ventas_anuladas !== 1 ? "s" : ""} hoy
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding:"12px 16px", borderTop:"1px solid var(--border2)" }}>
          <button onClick={onClose} style={{ width:"100%", padding:"9px 0", background:"var(--border2)", border:"none", borderRadius:8, color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CartItem ─────────────────────────────────────────────────────────────────
function CartItem({ item, onQty, onRemove, onEditQty }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding: OPERATOR_MODE ? "12px 14px" : "10px 12px", background:"var(--surface)", borderRadius:8, marginBottom:6, border:"1px solid var(--border2)" }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize: OPERATOR_MODE ? 13 : 12, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.nombre}</div>
        <div style={{ fontSize: OPERATOR_MODE ? 12 : 11, color:"var(--muted2)", fontFamily:"monospace" }}>{fmt(item.precio_unit)} c/u · Stock: {item.stock}</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <button onClick={() => onQty(item.producto_id, -1)} style={{ width: OPERATOR_MODE ? 28 : 22, height: OPERATOR_MODE ? 28 : 22, background:"var(--surface3)", border:"none", borderRadius:4, color:"#fff", fontWeight:700, fontSize: OPERATOR_MODE ? 16 : 14, cursor:"pointer" }}>−</button>
        <span onClick={() => onEditQty(item)} style={{ width: OPERATOR_MODE ? 34 : 28, textAlign:"center", fontFamily:"monospace", fontSize: OPERATOR_MODE ? 16 : 13, fontWeight:800, cursor:"pointer", color:"var(--accent)" }}>{item.cantidad}</span>
        <button onClick={() => onQty(item.producto_id, 1)} style={{ width: OPERATOR_MODE ? 28 : 22, height: OPERATOR_MODE ? 28 : 22, background:"var(--surface3)", border:"none", borderRadius:4, color:"#fff", fontWeight:700, fontSize: OPERATOR_MODE ? 16 : 14, cursor:"pointer" }}>+</button>
      </div>
      <div style={{ fontFamily:"monospace", fontSize: OPERATOR_MODE ? 17 : 13, fontWeight:800, color:"var(--accent)", minWidth: OPERATOR_MODE ? 84 : 60, textAlign:"right" }}>{fmt(item.precio_unit * item.cantidad)}</div>
      <button onClick={() => onRemove(item.producto_id)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", padding:2 }}>✕</button>
    </div>
  );
}

// ─── POS Principal ────────────────────────────────────────────────────────────
export default function POS() {
  const { user, sucursalActual, logout } = useAuth();
  const { onSaleCreated } = useSync();
  const navigate = useNavigate();

  // Config del negocio
  const [posConfig, setPosConfig] = useState({});

  // Estados de caja — Bug #4: inicia false, se verifica con backend
  const [cajaAbierta, setCajaAbierta]     = useState(false);
  const [cajaBloqueada, setCajaBloqueada] = useState(false);
  const [turnoActivo, setTurnoActivo]     = useState(false);
  const [turnoId, setTurnoId]             = useState(null);
  const [supervisorActivo, setSupervisor] = useState(false);
  const [resumenTurno, setResumenTurno]   = useState(null);

  // Modales
  const [showSupervisor, setShowSupervisor]     = useState(false);
  const [showCobro, setShowCobro]               = useState(false);
  const [showPark, setShowPark]                 = useState(false);
  const [showHistorial, setShowHistorial]       = useState(false);
  const [numpadItem, setNumpadItem]             = useState(null);
  const [ticket, setTicket]                     = useState(null);
  const [showClienteHistorial, setShowClienteHistorial] = useState(false);
  const [showDevolucion, setShowDevolucion]     = useState(false);
  const [showResumenDia, setShowResumenDia]     = useState(false);
  const [showGiftCard, setShowGiftCard]         = useState(false);
  const [showFavoritos, setShowFavoritos]       = useState(true);
  const [giftCardSaldo, setGiftCardSaldo]       = useState(0);
  const [giftCardCodigo, setGiftCardCodigo]     = useState("");

  const [fullscreen, setFullscreen] = useState(false);

  const isBrowserFullscreen = () => {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );
  };

  const requestBrowserFullscreen = () => {
    const el = document.documentElement;
    const request =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.msRequestFullscreen;

    if (!request) return Promise.reject(new Error("fullscreen-not-supported"));
    const result = request.call(el);
    if (result && typeof result.then === "function") return result;
    return Promise.resolve();
  };

  const exitBrowserFullscreen = () => {
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.msExitFullscreen;

    if (!exit) return Promise.resolve();
    const result = exit.call(document);
    if (result && typeof result.then === "function") return result;
    return Promise.resolve();
  };

  const toggleFullscreen = useCallback(async () => {
    try {
      if (isElectronRuntime() && window.electronAPI?.toggleFullscreen) {
        const next = await window.electronAPI.toggleFullscreen();
        setFullscreen(!!next);
        return;
      }

      if (isBrowserFullscreen()) {
        await exitBrowserFullscreen();
      } else {
        await requestBrowserFullscreen();
      }
      setFullscreen(isBrowserFullscreen());
    } catch {
      toast.error("No se pudo activar pantalla completa en este navegador");
    }
  }, []);

  useEffect(() => {
    if (isElectronRuntime() && window.electronAPI?.getFullscreen) {
      window.electronAPI.getFullscreen().then(v => setFullscreen(!!v)).catch(() => {});
      return;
    }

    const onChange = () => setFullscreen(isBrowserFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("MSFullscreenChange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("MSFullscreenChange", onChange);
    };
  }, []);

  // Bug #5: prevenir doble submit
  const procesandoRef = useRef(false);

  // Búsqueda
  const searchRef     = useRef(null);
  const listboxRef    = useRef(null);
  const cartListRef   = useRef(null);
  const mouseMovedRef = useRef(false);
  const [searchVal, setSearchVal]     = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const [showList, setShowList]       = useState(false);
  const [listIdx, setListIdx]         = useState(-1);
  const [buscando, setBuscando]       = useState(false);

  const [cartIdx, setCartIdx] = useState(-1);

  // Carrito y venta
  const [cart, setCart]             = useState([]);
  const [clienteId, setClienteId]   = useState("");
  const [clienteSearch, setClienteSearch] = useState("");
  const [showClientes, setShowClientes]   = useState(false);
  const [clientesList, setClientesList]   = useState([]);
  const [descuento, setDescuento]   = useState(0);
  const [razonDesc, setRazonDesc]   = useState("");
  const [nota, setNota]             = useState("");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [descuentosAuto, setDescuentosAuto]       = useState([]);
  const [descuentoAutTotal, setDescuentoAutTotal] = useState(0);
  const [loading, setLoading]       = useState(false);

  // Cargar config del POS
  useEffect(() => {
    const cargarConfig = async () => {
      try {
        if (isElectronRuntime()) {
          const cfg = await getRuntimeConfig();
          setPosConfig(cfg);
        } else {
          try {
            const { data } = await api.get("/pos/config");
            setPosConfig(data || {});
          } catch { /* usar defaults */ }
        }
      } catch { /* ignorar */ }
    };
    cargarConfig();
  }, []);

  // Bug #4: verificar turno real al iniciar
  useEffect(() => {
    const verificarTurno = async () => {
      if (!isOnline()) {
        // Offline: asumir abierto para no bloquear operación
        setCajaAbierta(true);
        setTurnoActivo(true);
        return;
      }
      try {
        const { data } = await api.get("/caja/panel", { params: { sucursal_id: sucursalActual } });
        const cajas = data?.cajas ?? [];
        const cajaConTurno = cajas.find(c => c.turno_activo);
        if (cajaConTurno) {
          setCajaAbierta(true);
          setTurnoActivo(true);
          setTurnoId(cajaConTurno.turno_activo.id);
          setResumenTurno(cajaConTurno.turno_activo);
        } else {
          setCajaAbierta(cajas.length > 0);
          setTurnoActivo(false);
        }
      } catch {
        // Si falla, asumir activo para no bloquear
        setCajaAbierta(true);
        setTurnoActivo(true);
      }
    };
    verificarTurno();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalActual]);

  // Clientes
  useEffect(() => {
    db.clientes.toArray().then(setClientesList).catch(() => setClientesList([]));
  }, []);

  const clientesFiltrados = clientesList.filter(c =>
    c.nombre?.toLowerCase().includes(clienteSearch.toLowerCase()) ||
    c.email?.toLowerCase().includes(clienteSearch.toLowerCase())
  ).slice(0, 8);
  const clienteSeleccionado = clientesList.find(c => c.id === Number(clienteId));

  // Descuentos automáticos
  useEffect(() => {
    if (cart.length === 0) { setDescuentosAuto([]); setDescuentoAutTotal(0); return; }
    const calcular = async () => {
      if (isOnline()) {
        try {
          const { data } = await api.post("/promociones/calcular", {
            items: cart.map(c => ({ producto_id: c.producto_id, cantidad: c.cantidad, precio_unit: c.precio_unit })),
            cliente_id: clienteId ? Number(clienteId) : null,
            sucursal_id: sucursalActual,
          });
          setDescuentosAuto(data?.detalles || []);
          setDescuentoAutTotal(Number(data?.descuentoTotal || 0));
          return;
        } catch { /* offline fallback */ }
      }
      const { descuentoTotal, detalles } = await calcularDescuentosOffline(
        cart.map(c => ({ precio_unit: c.precio_unit, cantidad: c.cantidad, producto_id: c.producto_id })),
        clienteId
      );
      setDescuentosAuto(detalles);
      setDescuentoAutTotal(descuentoTotal);
    };
    calcular();
  }, [cart, clienteId, sucursalActual]);

  // Búsqueda de productos
  const buscarProductos = useCallback(async (q) => {
    if (!q || q.length < 1) { setSugerencias([]); setShowList(false); return; }
    setBuscando(true);
    try {
      let resultados;
      if (isOnline()) {
        const { data } = await api.get("/pos/productos", { params: { q, sucursal_id: sucursalActual } });
        resultados = Array.isArray(data) ? data : (data?.data || []);
      } else {
        resultados = await buscarProductosLocal(q, sucursalActual);
      }
      setSugerencias(resultados);
      setShowList(resultados.length > 0);
      setListIdx(-1);
      mouseMovedRef.current = false;
    } catch {
      const resultados = await buscarProductosLocal(q, sucursalActual);
      setSugerencias(resultados);
      setShowList(resultados.length > 0);
      mouseMovedRef.current = false;
    } finally {
      setBuscando(false);
    }
  }, [sucursalActual]);

  useEffect(() => {
    if (listIdx < 0 || !listboxRef.current) return;
    const item = listboxRef.current.children[listIdx];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [listIdx]);

  const searchTimer = useRef(null);
  const handleSearchChange = (val) => {
    setSearchVal(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => buscarProductos(val), 220);
  };

  // Scanner
  const barcodeBuffer = useRef("");
  const barcodeTimer  = useRef(null);
  const lastKeyTime   = useRef(0);

  useEffect(() => {
    const onKeyDown = async (e) => {
      if (showSupervisor || numpadItem || showCobro || showPark || showHistorial || showDevolucion || showResumenDia) return;

      const fnMap = { F1:"caja", F2:"bloquear", F3:"devolucion", F4:"resumen", F5:"buscar", F6:"supervisor", F7:"park", F8:"historial", F9:"favoritos", F10:"venta" };
      if (fnMap[e.key]) { e.preventDefault(); handleFnKey(fnMap[e.key]); return; }
      if (e.key === "F11") {
        // Nota: algunos navegadores reservan F11 y no siempre lo entregan al sitio.
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (e.altKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        const m = METODOS_PAGO[Number(e.key) - 1];
        if (m) setMetodoPago(m.val);
        return;
      }

      if (document.activeElement === searchRef.current) return;

      const now   = Date.now();
      const delta = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (e.key === "Enter" && barcodeBuffer.current.length >= 3) {
        e.preventDefault();
        const code = barcodeBuffer.current;
        barcodeBuffer.current = "";
        clearTimeout(barcodeTimer.current);
        await buscarPorScanner(code);
        return;
      }

      if (/^[\w\d\-]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (delta < 80) {
          barcodeBuffer.current += e.key;
          clearTimeout(barcodeTimer.current);
          barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ""; }, 300);
        } else {
          barcodeBuffer.current = "";
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSupervisor, numpadItem, cart, sucursalActual, showPark, showHistorial, showCobro, showDevolucion, showResumenDia, toggleFullscreen]);

  const buscarPorScanner = async (code) => {
    try {
      let prod = null;
      if (isOnline()) {
        const { data } = await api.get("/pos/productos", { params: { q: code, sucursal_id: sucursalActual } });
        const list = Array.isArray(data) ? data : (data?.data || []);
        prod = list.find(p => p.codigo_barras === code || p.codigo === code) || list[0];
      } else {
        prod = await buscarPorBarcode(code, sucursalActual);
        if (!prod) {
          const resultados = await buscarProductosLocal(code, sucursalActual);
          prod = resultados[0];
        }
      }
      if (prod) {
        addToCart(prod);
        toast.success(`+ ${prod.nombre}`, { duration: 1200, position: "bottom-right" });
      } else {
        toast.error(`Código no encontrado: ${code}`);
        searchRef.current?.focus();
        setSearchVal(code);
        buscarProductos(code);
      }
    } catch { toast.error("Error al buscar código"); }
  };

  // Fn Keys
  const handleFnKey = (action) => {
    if (cajaBloqueada && !["bloquear","supervisor"].includes(action)) {
      toast.error("Caja bloqueada. Use F6 para desbloquear.");
      return;
    }
    switch (action) {
      case "caja":     navigate("/caja"); break;
      case "bloquear":
        setCajaBloqueada(v => {
          if (!v) { toast.success("Caja bloqueada"); return true; }
          if (supervisorActivo) { toast.success("Caja desbloqueada"); return false; }
          setShowSupervisor(true);
          return v;
        });
        break;
      case "turno":
        if (!supervisorActivo) { setShowSupervisor(true); return; }
        setTurnoActivo(v => !v);
        toast.success(turnoActivo ? "Turno cerrado" : "Turno abierto");
        break;
      case "buscar":   searchRef.current?.focus(); break;
      case "supervisor":
        if (supervisorActivo) { setSupervisor(false); toast("Modo supervisor desactivado"); }
        else setShowSupervisor(true);
        break;
      case "park":       setShowPark(true); break;
      case "historial":  setShowHistorial(true); break;
      case "devolucion": setShowDevolucion(true); break;
      case "resumen":    setShowResumenDia(true); break;
      case "favoritos":  setShowFavoritos(v => !v); break;
      case "venta":      procesarVenta(); break;
    }
  };

  const focusSearch = useCallback(() => {
    setCartIdx(-1);
    searchRef.current?.focus();
  }, []);

  // Navegación carrito por teclado
  const handleCartKeyDown = (e) => {
    if (cart.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCartIdx(i => Math.min(i + 1, cart.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); const next = cartIdx - 1; if (next < 0) focusSearch(); else setCartIdx(next); }
    else if (e.key === "ArrowRight" && cartIdx >= 0) { e.preventDefault(); updateQty(cart[cartIdx].producto_id, 1); }
    else if (e.key === "ArrowLeft" && cartIdx >= 0) { e.preventDefault(); updateQty(cart[cartIdx].producto_id, -1); }
    else if ((e.key === "Delete" || e.key === "Backspace") && cartIdx >= 0) {
      e.preventDefault(); removeFromCart(cart[cartIdx].producto_id); setCartIdx(i => Math.max(0, i - 1));
    }
    else if (e.key === "Escape") focusSearch();
    else if (e.key === "Enter" && cartIdx >= 0) setNumpadItem(cart[cartIdx]);
  };

  const addToCart = (prod) => {
    if ((prod.stock || 0) === 0) { toast.error("Sin stock disponible"); return; }
    const enCarrito = cart.find(c => c.producto_id === prod.id)?.cantidad || 0;
    if (enCarrito >= prod.stock) { toast.error("Stock insuficiente"); return; }
    setCart(prev => {
      const exists = prev.find(c => c.producto_id === prod.id);
      if (exists) return prev.map(c => c.producto_id === prod.id ? { ...c, cantidad: c.cantidad + 1 } : c);
      return [...prev, {
        producto_id:  prod.id,
        nombre:       prod.nombre,
        precio_unit:  prod.precio,
        cantidad:     1,
        stock:        prod.stock || 999,
        alicuota_iva: prod.alicuota_iva ?? 21,
        codigo:       prod.codigo_barras || prod.codigo || "",
      }];
    });
    setSearchVal(""); setSugerencias([]); setShowList(false);
  };

  const updateQty     = (id, delta) => setCart(prev => prev.map(c => c.producto_id === id ? { ...c, cantidad: Math.min(c.stock, Math.max(1, c.cantidad + delta)) } : c));
  const setQty        = (id, qty)   => { if (qty <= 0) { setCart(prev => prev.filter(c => c.producto_id !== id)); return; } setCart(prev => prev.map(c => c.producto_id === id ? { ...c, cantidad: Math.min(c.stock, qty) } : c)); };
  const removeFromCart = (id)       => setCart(prev => prev.filter(c => c.producto_id !== id));

  // Park & Resume
  const handleResume = (parkedItem) => {
    if (parkedItem.cart?.length) {
      setCart(parkedItem.cart);
      if (parkedItem.clienteId) { setClienteId(parkedItem.clienteId); setClienteSearch(parkedItem.clienteNombre || ""); }
      toast.success("Venta retomada");
    }
  };

  // Totales
  const subtotal      = cart.reduce((s, c) => s + c.precio_unit * c.cantidad, 0);
  const descAuto      = descuentoAutTotal || 0;
  const descManual    = Number(descuento || 0);
  const baseImponible = Math.max(0, subtotal - descAuto - descManual);
  const iva           = baseImponible * IVA_RATE;
  const total         = baseImponible + iva;

  // Procesar venta
  const procesarVenta = () => {
    if (!cajaAbierta)  { toast.error("La caja está cerrada"); return; }
    if (cajaBloqueada) { toast.error("La caja está bloqueada"); return; }
    if (!turnoActivo)  { toast.error("No hay turno activo. Abra un turno en Caja (F1)"); return; }
    if (!cart.length)  { toast.error("El carrito está vacío"); return; }
    if (total <= 0)    { toast.error("Total inválido"); return; }
    if (procesandoRef.current) return; // Bug #5: evitar doble apertura
    setShowCobro(true);
  };

  // Confirmar cobro
  const confirmarCobro = async (pagosPayload, efectivoRecibido, vuelto, puntosCanjeados = 0, descuentoPuntos = 0) => {
    if (procesandoRef.current) return; // Bug #5: prevenir doble submit
    procesandoRef.current = true;
    setShowCobro(false);
    const metodoPrincipal = pagosPayload[0].metodo_pago;
    setMetodoPago(metodoPrincipal);
    setLoading(true);

    const totalFinal = Math.max(0, total - descuentoPuntos);

    const ventaData = {
      sucursal_id:      sucursalActual,
      cliente_id:       clienteId ? Number(clienteId) : null,
      items:            cart.map(c => ({ producto_id: c.producto_id, cantidad: c.cantidad, precio_unit: c.precio_unit })),
      descuento:        descManual + descuentoPuntos,
      razon_descuento:  razonDesc || (descuentoPuntos > 0 ? "Canje de puntos" : "Descuento manual"),
      metodo_pago:      metodoPrincipal,
      pagos:            pagosPayload,
      nota:             nota || undefined,
      puntos_canjeados: puntosCanjeados || undefined,
    };

    try {
      let ventaRespuesta;
      let wasOffline = false;

      if (isOnline()) {
        try {
          const { data } = await api.post("/pos/ventas", ventaData);
          ventaRespuesta = data;
        } catch (err) {
          if (!navigator.onLine || err.code === "ECONNABORTED" || err.code === "ERR_NETWORK") {
            const offline_id = await queueVentaOffline(ventaData);
            ventaRespuesta = { numero: offline_id, total: totalFinal, _offline: true };
            wasOffline = true;
          } else {
            throw err;
          }
        }
      } else {
        const offline_id = await queueVentaOffline(ventaData);
        ventaRespuesta = { numero: offline_id, total: totalFinal, _offline: true };
        wasOffline = true;
      }

      const puntosGanados = ventaRespuesta.puntos_ganados || Math.floor(totalFinal / 100);

      const ticketData = {
        numero:          ventaRespuesta.numero,
        total:           totalFinal,
        descuento:       descManual,
        metodo_pago:     metodoPrincipal,
        pagos:           pagosPayload,
        vuelto,
        puntosCanjeados,
        puntosGanados,
        cliente_nombre:  clienteSeleccionado?.nombre || "Consumidor Final",
        nota,
        items:           cart.map(c => ({ ...c, subtotal: c.precio_unit * c.cantidad })),
        offline:         wasOffline,
      };

      setTicket(ticketData);

      // Abrir cajón de efectivo si el pago es en efectivo
      if (metodoPrincipal === "efectivo") {
        openCashDrawer(posConfig.printer_name || undefined).catch(() => {});
      }

      setCart([]); setClienteId(""); setClienteSearch("");
      setDescuento(0); setRazonDesc(""); setNota("");

      await onSaleCreated();

      if (wasOffline) {
        toast(`Venta guardada offline (${ventaRespuesta.numero})`, { icon: "📴", duration: 4000 });
      } else {
        toast.success(`✓ Venta ${ventaRespuesta.numero} procesada`, { duration: 3000 });
      }
      searchRef.current?.focus();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al procesar la venta");
    } finally {
      setLoading(false);
      procesandoRef.current = false;
    }
  };

  const handleSearchKeyDown = (e) => {
    if (showList && sugerencias.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setListIdx(i => Math.min(i + 1, sugerencias.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setListIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (listIdx >= 0 && sugerencias[listIdx]) addToCart(sugerencias[listIdx]);
        else if (sugerencias.length === 1) addToCart(sugerencias[0]);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setShowList(false); setSearchVal(""); return; }
    }
    if (e.key === "Enter" && sugerencias.length === 0) { e.preventDefault(); procesarVenta(); return; }
    if (e.key === "Escape") { e.preventDefault(); setSearchVal(""); setSugerencias([]); setShowList(false); return; }
    if (e.key === "ArrowDown" && !showList && cart.length > 0) {
      e.preventDefault(); setCartIdx(0); searchRef.current?.blur(); cartListRef.current?.focus();
    }
  };

  const imprimirTicket = async (t) => {
    const html = generarHTMLTicket(t, posConfig);
    await imprimirHTML(html, posConfig);
  };

  const estadoCaja  = cajaBloqueada ? "bloqueada" : !cajaAbierta ? "cerrada" : !turnoActivo ? "sin-turno" : "activa";
  const estadoColor = { activa:"var(--success)", cerrada:"var(--danger)", bloqueada:"#e8a923", "sin-turno":"#555" }[estadoCaja];
  const estadoLabel = { activa:"Caja Activa", cerrada:"Caja Cerrada", bloqueada:"Caja Bloqueada", "sin-turno":"Sin Turno" }[estadoCaja];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg)", color:"var(--text)", overflow:"hidden" }}>
      <OfflineBanner />

      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 14px", borderBottom:"1px solid var(--border2)", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:estadoColor, boxShadow:`0 0 6px ${estadoColor}` }} />
          <span style={{ fontSize:11, fontWeight:700, color:estadoColor, textTransform:"uppercase", letterSpacing:1 }}>{estadoLabel}</span>
        </div>
        {supervisorActivo && (
          <span style={{ background:"#7c3aed", color:"#fff", padding:"2px 8px", borderRadius:10, fontSize:10, fontWeight:700 }}>SUPERVISOR</span>
        )}
        {/* Resumen del turno en topbar */}
        {resumenTurno && turnoActivo && (
          <div style={{ display:"flex", gap:10, marginLeft:8, fontSize:11, color:"var(--muted)" }}>
            <span>💰<strong style={{ color:"var(--accent)", fontFamily:"monospace", marginLeft:3 }}>{fmt(resumenTurno.total_efectivo || 0)}</strong></span>
            <span>💳<strong style={{ color:"var(--accent)", fontFamily:"monospace", marginLeft:3 }}>{fmt((resumenTurno.total_tarjeta || 0) + (resumenTurno.total_transferencia || 0))}</strong></span>
            <span>Tot:<strong style={{ color:"var(--success)", fontFamily:"monospace", marginLeft:3 }}>{fmt(resumenTurno.total_ventas || 0)}</strong></span>
          </div>
        )}
        <SyncIndicator variant="topbar" />
        <div style={{ marginLeft:"auto", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
          <span style={{ fontSize:10, color: fullscreen ? "var(--accent)" : "var(--muted2)", fontWeight:700 }}>
            {fullscreen ? "Pantalla completa" : "Modo normal"}
          </span>
          <span style={{ fontSize:12, color:"var(--muted2)" }}>{user?.nombre}</span>
        </div>
        <button onClick={() => setShowHistorial(true)} title="Historial del turno (F8)"
          style={{ padding:"4px 8px", background:"var(--border2)", border:"none", borderRadius:6, color:"var(--text)", fontSize:11, cursor:"pointer" }}>
          📋 F8
        </button>
        <button onClick={() => setShowPark(true)} title="Ventas en espera (F7)"
          style={{ padding:"4px 8px", background:"var(--border2)", border:"none", borderRadius:6, color:"var(--text)", fontSize:11, cursor:"pointer" }}>
          ⏸ F7
        </button>
        <button onClick={() => navigate("/caja")}
          style={{ padding:"4px 10px", background:"var(--border2)", border:"none", borderRadius:6, color:"var(--text)", fontSize:11, cursor:"pointer" }}>
          Caja F1
        </button>
        <button onClick={() => navigate("/config")} title="Configuración"
          style={{ padding:"4px 8px", background:"none", border:"1px solid var(--border2)", borderRadius:6, color:"var(--muted2)", fontSize:14, cursor:"pointer", lineHeight:1 }}>
          ⚙
        </button>
        <button onClick={logout}
          style={{ padding:"4px 8px", background:"none", border:"1px solid var(--border2)", borderRadius:6, color:"var(--muted)", fontSize:11, cursor:"pointer" }}>
          Salir
        </button>
      </div>

      {/* ── Layout principal ────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", flex:1, overflow:"hidden" }}>

        {/* Panel izquierdo */}
        <div style={{ display:"flex", flexDirection:"column", borderRight:"1px solid var(--border2)", overflow:"hidden" }}>

          {/* Cliente */}
          <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--border2)" }}>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5, fontWeight:700, letterSpacing:1 }}>CLIENTE</div>
            <div style={{ position:"relative" }}>
              <input
                placeholder="Buscar cliente..."
                value={clienteSearch}
                onChange={e => { setClienteSearch(e.target.value); if (!e.target.value) setClienteId(""); setShowClientes(true); }}
                onFocus={() => setShowClientes(true)}
                onBlur={() => setTimeout(() => setShowClientes(false), 150)}
                style={inputStyle}
              />
              {showClientes && clienteSearch && clientesFiltrados.length > 0 && (
                <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,0.5)", zIndex:200, maxHeight:180, overflowY:"auto" }}>
                  {clientesFiltrados.map(c => (
                    <div key={c.id} onMouseDown={() => { setClienteId(String(c.id)); setClienteSearch(c.nombre); setShowClientes(false); }}
                      style={{ padding:"8px 12px", cursor:"pointer", borderBottom:"1px solid var(--border2)", fontSize:12 }}>
                      <div style={{ fontWeight:600 }}>{c.nombre}</div>
                      {c.email && <div style={{ color:"var(--muted2)", fontSize:11 }}>{c.email}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {clienteSeleccionado && (
              <div style={{ marginTop:5, fontSize:11, color:"var(--muted2)", display:"flex", justifyContent:"space-between" }}>
                <span>{clienteSeleccionado.nivel_vip || "estándar"}</span>
                <span style={{ color: (clienteSeleccionado.puntos_fidelizacion || 0) > 0 ? "var(--success)" : "#555" }}>
                  ★ {clienteSeleccionado.puntos_fidelizacion || 0} pts
                </span>
              </div>
            )}
          </div>

          {/* Método de pago */}
          <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--border2)" }}>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5, fontWeight:700, letterSpacing:1 }}>PAGO (Alt+1..6)</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
              {METODOS_PAGO.map(m => (
                <button key={m.val} onClick={() => setMetodoPago(m.val)}
                  style={{
                    padding:"6px 4px", borderRadius:7, border:`1px solid ${metodoPago === m.val ? "var(--accent)" : "var(--border2)"}`,
                    background: metodoPago === m.val ? "rgba(var(--accent-rgb),0.12)" : "var(--surface)",
                    color: metodoPago === m.val ? "var(--accent)" : "var(--muted2)",
                    fontWeight: metodoPago === m.val ? 700 : 400,
                    cursor:"pointer", fontSize:10,
                    display:"flex", flexDirection:"column", alignItems:"center", gap:1,
                  }}>
                  <span style={{ fontSize:13 }}>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Descuento + Nota */}
          <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--border2)" }}>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:4, fontWeight:700, letterSpacing:1 }}>DESCUENTO MANUAL</div>
            <div style={{ display:"flex", gap:6, marginBottom:8 }}>
              <input type="number" min="0" value={descuento}
                onChange={e => setDescuento(Number(e.target.value))}
                placeholder="0"
                style={{ ...inputStyle, width:72 }} />
              <input value={razonDesc} onChange={e => setRazonDesc(e.target.value)}
                placeholder="Razón"
                style={{ ...inputStyle, flex:1 }} />
            </div>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:4, fontWeight:700, letterSpacing:1 }}>NOTA / OBSERVACIÓN</div>
            <input
              value={nota} onChange={e => setNota(e.target.value)}
              placeholder="Ej: sin cebolla, retira mañana..."
              style={{ ...inputStyle, fontSize:12 }}
            />
          </div>

          {/* Descuentos automáticos */}
          {descuentosAuto.length > 0 && (
            <div style={{ padding:"5px 12px", borderBottom:"1px solid var(--border2)", background:"rgba(72,187,120,0.05)" }}>
              {descuentosAuto.map((d, i) => (
                <div key={i} style={{ fontSize:11, color:"var(--success)", display:"flex", justifyContent:"space-between" }}>
                  <span>🏷 {d.nombre}</span><span>-{fmt(d.monto)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Totales */}
          <div style={{ padding:"10px 12px", flex:1, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:8, fontWeight:700, letterSpacing:1 }}>DESGLOSE</div>
            <div style={{ display:"flex", flexDirection:"column", gap:5, fontFamily:"monospace", fontSize:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", color:"var(--muted2)" }}>
                <span>Subtotal</span><span>{fmt(subtotal)}</span>
              </div>
              {descAuto > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", color:"var(--success)" }}>
                  <span>Dto. automático</span><span>-{fmt(descAuto)}</span>
                </div>
              )}
              {descManual > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", color:"#e8a923" }}>
                  <span>Dto. manual</span><span>-{fmt(descManual)}</span>
                </div>
              )}
              <div style={{ display:"flex", justifyContent:"space-between", color:"var(--muted)" }}>
                <span>IVA (21%)</span><span>{fmt(iva)}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize: OPERATOR_MODE ? 28 : 22, fontWeight:800, color:"var(--accent)", borderTop:"1px solid var(--border2)", paddingTop:8, marginTop:4 }}>
                <span>TOTAL</span><span>{fmt(total)}</span>
              </div>
            </div>
            <button
              onClick={procesarVenta}
              disabled={loading || !cart.length || cajaBloqueada || !cajaAbierta}
              style={{
                marginTop:14, width:"100%", padding:"13px 0",
                background: (loading || !cart.length || cajaBloqueada) ? "#3d3d5c" : "#7c3aed",
                border:"none", borderRadius:10, color:"#fff",
                fontWeight:800, fontSize: OPERATOR_MODE ? 18 : 15, cursor: cart.length ? "pointer" : "not-allowed",
                letterSpacing:1,
              }}>
              {loading ? "Procesando..." : "COBRAR F10"}
            </button>
          </div>
        </div>

        {/* Panel derecho */}
        <div style={{ display:"flex", flexDirection:"column", overflow:"hidden" }}>

          <div style={{ padding:"10px 14px", borderBottom:"1px solid var(--border2)", flexShrink:0 }}>
            <div style={{ position:"relative" }}>
              <input
                ref={searchRef}
                value={searchVal}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => searchVal && setShowList(sugerencias.length > 0)}
                onBlur={() => setTimeout(() => setShowList(false), 150)}
                placeholder="Buscar por nombre, código o escanear barcode... (F5)"
                style={{ ...inputStyle, width:"100%", fontSize:14, padding:"11px 14px" }}
              />
              {buscando && (
                <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted2)", fontSize:12 }}>
                  Buscando...
                </span>
              )}
              {showList && sugerencias.length > 0 && (
                <div ref={listboxRef} style={{
                  position:"absolute", top:"calc(100% + 4px)", left:0, right:0,
                  background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:10,
                  boxShadow:"0 12px 32px rgba(0,0,0,0.6)", zIndex:300, maxHeight:280, overflowY:"auto",
                }}>
                  {sugerencias.map((p, idx) => (
                    <div key={p.id}
                      style={{
                        padding:"10px 14px", cursor:"pointer", borderBottom:"1px solid var(--border2)",
                        background: idx === listIdx ? "var(--border2)" : "transparent",
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                      }}
                      onMouseDown={() => addToCart(p)}
                      onMouseMove={() => { mouseMovedRef.current = true; }}
                      onMouseEnter={() => { if (mouseMovedRef.current) setListIdx(idx); }}
                    >
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:600, fontSize:13 }}>{p.nombre}</div>
                        <div style={{ fontSize:11, color:"var(--muted2)" }}>
                          {p.codigo_barras && <span style={{ marginRight:8 }}>🔖 {p.codigo_barras}</span>}
                          {p.categoria_nombre && <span>{p.categoria_nombre}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
                        <div>
                          <div style={{ fontFamily:"monospace", fontWeight:700, color:"var(--accent)", fontSize:14 }}>{fmt(p.precio)}</div>
                          <div style={{ fontSize:11, color: p.stock > 0 ? "var(--success)" : "var(--danger)" }}>Stock: {p.stock}</div>
                        </div>
                        <button
                          onMouseDown={async (e) => {
                            e.stopPropagation();
                            const esFav = await isFavorito(p.id);
                            if (esFav) {
                              await removeFavorito(p.id);
                              toast("Quitado de favoritos");
                            } else {
                              await addFavorito({ ...p, sucursal_id: sucursalActual });
                              toast.success("⭐ Añadido a favoritos");
                            }
                          }}
                          title="Añadir/quitar de favoritos"
                          style={{ background:"none", border:"none", cursor:"pointer", fontSize:16, color:"#e8a923", padding:"2px 4px", flexShrink:0 }}>
                          ⭐
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            ref={cartListRef} tabIndex={0} onKeyDown={handleCartKeyDown}
            style={{ flex:1, overflowY:"auto", padding:"10px 14px", outline:"none" }}
          >
            {cart.length === 0 ? (
              <div style={{ textAlign:"center", color:"#555", marginTop:60, fontSize:14 }}>
                <div style={{ fontSize:48, marginBottom:12, opacity:0.3 }}>🛒</div>
                <div>El carrito está vacío</div>
                <div style={{ fontSize:12, marginTop:8 }}>Escanee un código o busque un producto</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize:11, color:"var(--muted)", marginBottom:8, display:"flex", justifyContent:"space-between" }}>
                  <span>{cart.length} producto{cart.length !== 1 ? "s" : ""}</span>
                  <span>{cart.reduce((s, c) => s + c.cantidad, 0)} unidades</span>
                </div>
                {cart.map((item, i) => (
                  <div key={item.producto_id} onClick={() => setCartIdx(i)}
                    style={{ outline: i === cartIdx ? "2px solid var(--accent)" : "none", borderRadius:8, marginBottom:6 }}>
                    <CartItem item={item} onQty={updateQty} onRemove={removeFromCart} onEditQty={(it) => setNumpadItem(it)} />
                  </div>
                ))}
              </>
            )}
          </div>

          {/* F-Keys */}
          <div style={{ display:"flex", gap:3, padding:"6px 10px", borderTop:"1px solid var(--border2)", background:"var(--surface2)", flexShrink:0 }}>
            {[
              { key:"F1",  label:"Caja",       action:"caja" },
              { key:"F2",  label:"Bloquear",   action:"bloquear" },
              { key:"F5",  label:"Buscar",     action:"buscar" },
              { key:"F6",  label:"Supervisor", action:"supervisor" },
              { key:"F7",  label:"Espera",     action:"park" },
              { key:"F8",  label:"Historial",  action:"historial" },
              { key:"F10", label:"Cobrar",     action:"venta", special: true },
              { key:"F11", label:"Pantalla",   action:"fullscreen" },
            ].map(fn => (
              <button key={fn.key}
                onClick={() => fn.action === "fullscreen" ? toggleFullscreen() : handleFnKey(fn.action)}
                style={{
                  padding:"4px 6px", flex: fn.key === "F10" ? 2 : 1,
                  background: fn.special ? "#7c3aed" : (fn.action === "fullscreen" && fullscreen) ? "rgba(var(--accent-rgb),0.15)" : "var(--border2)",
                  border: `1px solid ${(fn.action === "fullscreen" && fullscreen) ? "var(--accent)" : "var(--surface3)"}`,
                  borderRadius:5, color: fn.special ? "#fff" : (fn.action === "fullscreen" && fullscreen) ? "var(--accent)" : "var(--muted2)",
                  fontSize:10, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1,
                }}>
                <span style={{ fontSize:8, color: fn.special ? "rgba(255,255,255,0.6)" : "var(--muted)" }}>{fn.key}</span>
                <span>
                  {fn.key === "F2" ? (cajaBloqueada ? "Desbloquear" : "Bloquear")
                   : fn.key === "F6" ? (supervisorActivo ? "Des.Sup" : "Supervisor")
                   : fn.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Modales ──────────────────────────────────────────────────── */}
      {showCobro && (
        <CobroModal
          total={total}
          clienteSeleccionado={clienteSeleccionado}
          onConfirm={confirmarCobro}
          onClose={() => { setShowCobro(false); setTimeout(() => searchRef.current?.focus(), 0); }}
        />
      )}
      {showSupervisor && (
        <SupervisorModal
          onAuth={() => { setSupervisor(true); setShowSupervisor(false); toast.success("Modo supervisor activado"); setCajaBloqueada(false); }}
          onClose={() => setShowSupervisor(false)}
        />
      )}
      {numpadItem && (
        <NumpadModal
          title={`Cantidad: ${numpadItem.nombre}`}
          value={numpadItem.cantidad}
          maxValue={numpadItem.stock}
          onConfirm={(qty) => { setQty(numpadItem.producto_id, qty); setNumpadItem(null); }}
          onClose={() => setNumpadItem(null)}
        />
      )}
      {ticket && (
        <TicketModal
          ticket={ticket}
          onImprimir={() => imprimirTicket(ticket)}
          onClose={() => { setTicket(null); setTimeout(() => searchRef.current?.focus(), 0); }}
        />
      )}
      {showPark && (
        <ParkModal
          cart={cart}
          clienteId={clienteId}
          clienteNombre={clienteSeleccionado?.nombre || ""}
          onResume={handleResume}
          onClose={() => setShowPark(false)}
        />
      )}
      {showHistorial && (
        <HistorialModal
          sucursalActual={sucursalActual}
          turnoId={turnoId}
          posConfig={posConfig}
          onClose={() => setShowHistorial(false)}
        />
      )}
    </div>
  );
}

const btnStyle = {
  flex:1, padding:"10px 0", borderRadius:8, border:"none",
  background:"var(--border2)", color:"var(--text)", fontWeight:600, cursor:"pointer", fontSize:13,
};

const inputStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border2)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
