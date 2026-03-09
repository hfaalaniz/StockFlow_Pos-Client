import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import toast from "react-hot-toast";
import { getRuntimeVersion } from "../services/runtime";

export default function Login() {
  const { login, serverURL } = useAuth();
  const navigate = useNavigate();

  const [url, setUrl]         = useState(serverURL || "http://localhost:4000");
  const [email, setEmail]     = useState("");
  const [password, setPass]   = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [testando, setTestando] = useState(false);
  const [version, setVersion] = useState("web");

  useEffect(() => {
    getRuntimeVersion().then(setVersion).catch(() => setVersion("web"));
  }, []);

  const testConexion = async () => {
    setTestando(true);
    setError("");
    try {
      const base = url.replace(/\/+$/, "");
      await api.get(`${base}/api/pos/status`);
      toast.success("Servidor accesible");
    } catch {
      setError("No se pudo conectar al servidor. Verificá la URL e IP.");
      toast.error("Sin respuesta del servidor");
    } finally {
      setTestando(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password, url.trim());
      navigate("/pos");
    } catch (err) {
      const msg = err.response?.data?.error || err.message || "Error de conexión";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseApp = async () => {
    try {
      if (window?.electronAPI?.closeApp) {
        await window.electronAPI.closeApp();
        return;
      }

      // En web algunos navegadores bloquean cerrar pestañas no abiertas por script.
      window.open("", "_self");
      window.close();
      setTimeout(() => {
        toast.error("El navegador bloqueó el cierre automático de la pestaña.");
      }, 250);
    } catch {
      toast.error("No se pudo cerrar la aplicación.");
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "var(--bg)",
      padding: 24,
    }}>
      {/* Logo / marca */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🛒</div>
        <h1 style={{ color: "var(--accent)", fontSize: 28, fontWeight: 800, letterSpacing: 2 }}>
          STOCKFLOW POS
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>Terminal de Punto de Venta</p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border2)",
          borderRadius: 12,
          padding: 32,
          width: "100%",
          maxWidth: 400,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* URL del servidor */}
        <div>
          <label style={{ fontSize: 12, color: "var(--muted2)", display: "block", marginBottom: 6 }}>
            URL del servidor (IP de la red local)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://192.168.1.100:4000"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={testConexion}
              disabled={testando}
              style={{
                padding: "0 14px",
                background: "var(--border2)",
                border: "1px solid var(--surface3)",
                borderRadius: 8,
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              {testando ? "..." : "Probar"}
            </button>
          </div>
        </div>

        {/* Email */}
        <div>
          <label style={{ fontSize: 12, color: "var(--muted2)", display: "block", marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="vendedor@empresa.com"
            required
            autoFocus
            style={inputStyle}
          />
        </div>

        {/* Contraseña */}
        <div>
          <label style={{ fontSize: 12, color: "var(--muted2)", display: "block", marginBottom: 6 }}>
            Contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPass(e.target.value)}
            placeholder="••••••••"
            required
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{
            background: "rgba(220,38,38,0.12)",
            border: "1px solid var(--danger)",
            borderRadius: 8,
            padding: "10px 14px",
            color: "var(--danger)",
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? "var(--surface3)" : "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "12px 0",
            fontSize: 15,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            marginTop: 4,
            transition: "background 0.2s",
          }}
        >
          {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
        </button>

        <button
          type="button"
          onClick={handleCloseApp}
          style={{
            background: "transparent",
            color: "var(--muted2)",
            border: "1px solid var(--surface3)",
            borderRadius: 8,
            padding: "10px 0",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cerrar aplicación
        </button>
      </form>

      <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 20 }}>
        StockFlow POS <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>v{version}</span>
      </p>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "var(--border2)",
  border: "1px solid var(--surface3)",
  borderRadius: 8,
  padding: "10px 14px",
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
};
