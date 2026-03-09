import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SyncProvider } from "./context/SyncContext";
import { SocketProvider } from "./context/SocketContext";
import Login from "./pages/Login";
import POS from "./pages/POS";
import Caja from "./pages/Caja";
import Configuracion from "./pages/Configuracion";

function PrivateRoute({ children }) {
  const { token, loading } = useAuth();
  if (loading) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg)", color: "var(--muted)", fontSize: 14, flexDirection: "column", gap: 12,
      }}>
        <div style={{ fontSize: 32 }}>⚙</div>
        <span>Iniciando StockFlow POS...</span>
      </div>
    );
  }
  return token ? children : <Navigate to="/login" replace />;
}

// Envuelve rutas autenticadas con Socket + Sync
function AuthenticatedRoute({ children }) {
  return (
    <SocketProvider>
      <SyncProvider>
        {children}
      </SyncProvider>
    </SocketProvider>
  );
}

function AppRoutes() {
  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--surface2)",
            color: "var(--text)",
            border: "1px solid var(--border2)",
            fontSize: 13,
          },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/pos" element={
          <PrivateRoute>
            <AuthenticatedRoute>
              <POS />
            </AuthenticatedRoute>
          </PrivateRoute>
        } />

        <Route path="/caja" element={
          <PrivateRoute>
            <AuthenticatedRoute>
              <Caja />
            </AuthenticatedRoute>
          </PrivateRoute>
        } />

        <Route path="/config" element={
          <PrivateRoute>
            <AuthenticatedRoute>
              <Configuracion />
            </AuthenticatedRoute>
          </PrivateRoute>
        } />

        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
}
