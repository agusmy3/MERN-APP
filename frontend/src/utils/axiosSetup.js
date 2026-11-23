import axios from 'axios';

// Handler dipasang oleh AuthProvider. Interceptor didaftarkan di level modul
// (di-import dari main.jsx sebelum render) supaya request pertama dari
// komponen mana pun sudah melewati interceptor ini.
let onUnauthorized = null;
let onForbidden = null;

export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

export const setForbiddenHandler = (handler) => {
  onForbidden = handler;
};

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const isLogin = url.startsWith('/api/auth/login');

    // 401 = sesi tidak valid -> logout. Kecuali dari login (mis. password salah).
    if (status === 401 && !isLogin && onUnauthorized) {
      onUnauthorized();
    }

    // 403 = sudah login tapi tidak punya izin. Tidak logout; izin dimuat ulang
    // (mungkin baru diubah admin) supaya tampilan menyesuaikan. Pesan error tetap
    // ditampilkan oleh pemanggil (mis. toast di useCrudDrawer).
    if (status === 403 && !isLogin && onForbidden) {
      onForbidden();
    }

    return Promise.reject(error);
  }
);
