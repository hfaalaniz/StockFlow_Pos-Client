import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api, { setServerURL, setAuthToken } from "../services/api";

const AuthContext = createContext(null);

// Permisos base por rol (mismos que el sistema central)
const PERMISOS_BASE = {
  admin: {
    dashboard: ["ver"], inventario: ["ver","crear","editar","eliminar","ajustar_stock"],
    pos: ["ver","vender"], ventas: ["ver","anular","exportar","enviar_factura"],
    stock: ["ver","transferir","entrada","exportar"], clientes: ["ver","crear","editar","eliminar"],
    sucursales: ["ver","crear","editar","eliminar"], usuarios: ["ver","crear","editar","eliminar"],
    compras: ["ver","crear","editar","eliminar","recibir","cancelar"],
    proveedores: ["ver","crear","editar","eliminar"], reportes: ["ver","exportar"],
    roles: ["ver","crear","editar","eliminar"], caja: ["ver","abrir","cerrar"], auditoria: ["ver"],
  },
  gerente: {
    dashboard: ["ver"], inventario: ["ver","crear","editar","ajustar_stock"],
    pos: ["ver","vender"], ventas: ["ver","anular","exportar","enviar_factura"],
    stock: ["ver","transferir","entrada","exportar"], clientes: ["ver","crear","editar"],
    sucursales: ["ver"], usuarios: ["ver"], compras: ["ver","crear","editar","recibir"],
    proveedores: ["ver","crear","editar"], reportes: ["ver","exportar"],
    caja: ["ver","abrir","cerrar"], auditoria: [],
  },
  vendedor: {
    dashboard: ["ver"], inventario: ["ver"], pos: ["ver","vender"],
    ventas: ["ver","enviar_factura"], stock: ["ver"], clientes: ["ver","crear","editar"],
    sucursales: ["ver"], usuarios: [], compras: ["ver"], proveedores: ["ver"],
    reportes: [], caja: ["ver"], auditoria: [],
  },
};

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [token, setToken]             = useState(null);
  const [loading, setLoading]         = useState(true);
  const [sucursalActual, setSucursal] = useState(1);
  const [serverURL, setServerURLState] = useState("http://localhost:4000");

  // Al montar: cargar config persistida desde Electron (JWT + serverURL)
  useEffect(() => {
    const init = async () => {
      try {
        const isElectron = typeof window !== "undefined" && window.electronAPI?.isElectron;

        if (isElectron) {
          const config = await window.electronAPI.getConfig();
          if (config.serverURL) {
            setServerURL(config.serverURL);
            setServerURLState(config.serverURL);
          }
          if (config.sucursal_id) setSucursal(Number(config.sucursal_id));

          if (config.token) {
            setAuthToken(config.token);
            setToken(config.token);
            const { data } = await api.get("/auth/me");
            setUser(data);
          }
        } else {
          // Fallback browser (modo dev sin Electron)
          const savedToken = localStorage.getItem("pos_token");
          const savedSucursal = localStorage.getItem("pos_sucursal");
          if (savedSucursal) setSucursal(Number(savedSucursal));
          if (savedToken) {
            setAuthToken(savedToken);
            setToken(savedToken);
            const { data } = await api.get("/auth/me");
            setUser(data);
          }
        }
      } catch {
        // Token inválido o servidor no disponible — ir a login
        await _clearAuth();
      } finally {
        setLoading(false);
      }
    };

    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escuchar evento global de 401 (del interceptor de api.js)
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener("pos:unauthorized", handler);
    return () => window.removeEventListener("pos:unauthorized", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const _clearAuth = async () => {
    setToken(null);
    setUser(null);
    setAuthToken(null);
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.setConfig({ token: null }).catch(() => {});
    } else {
      localStorage.removeItem("pos_token");
    }
  };

  /** login recibe también la URL del servidor (ingresada en el campo de Login) */
  const login = async (email, password, url) => {
    if (url) {
      setServerURL(url);
      setServerURLState(url);
    }
    const { data } = await api.post("/auth/login", { email, password });
    const newToken = data.token;
    const newUser  = data.user;

    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);

    const sucId = newUser.sucursal_id || sucursalActual;
    setSucursal(sucId);

    // Persistir en Electron o localStorage (fallback)
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.setConfig({
        token: newToken,
        serverURL: url || serverURL,
        sucursal_id: sucId,
      });
    } else {
      localStorage.setItem("pos_token", newToken);
      localStorage.setItem("pos_sucursal", String(sucId));
    }

    return data;
  };

  const logout = useCallback(async () => {
    await _clearAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tienePermiso = useCallback((modulo, accion) => {
    if (!user) return false;
    const permisosRol = PERMISOS_BASE[user.rol] || {};
    return (permisosRol[modulo] || []).includes(accion);
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, logout,
      sucursalActual, serverURL, tienePermiso,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
