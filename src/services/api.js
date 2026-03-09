import axios from "axios";

// URL del servidor: se puede sobrescribir al momento del login (configuración LAN)
// eslint-disable-next-line no-undef
const defaultURL = typeof __DEFAULT_SERVER_URL__ !== "undefined"
  ? __DEFAULT_SERVER_URL__
  : "http://localhost:4000";

const api = axios.create({
  baseURL: `${defaultURL}/api`,
  timeout: 8000, // 8s — LAN local debe ser rápido
});

/** Cambiar la URL del servidor en tiempo de ejecución (al ingresar IP en Login) */
export function setServerURL(url) {
  const base = url.replace(/\/+$/, ""); // quitar trailing slash
  api.defaults.baseURL = `${base}/api`;
}

/** Inyectar JWT en todas las requests */
export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}

// Interceptor de respuesta: 401 → evento global para que AuthContext haga logout
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.dispatchEvent(new CustomEvent("pos:unauthorized"));
    }
    return Promise.reject(err);
  }
);

export default api;
