import { lazy } from 'react';

const RELOAD_KEY = 'chunkReloadAt';

/**
 * React.lazy + pemulihan saat file chunk tidak ditemukan. Setelah aplikasi di-deploy ulang, tab yang masih membuka
 * versi lama meminta chunk dengan nama (hash) lama yang sudah tidak ada -> "Failed to fetch dynamically imported module".
 * Halaman dimuat ulang SEKALI untuk mengambil versi baru; bila tetap gagal dalam 1 menit, error diteruskan (tanpa loop).
 */
export const lazyWithReload = (importer) => lazy(async () => {
  try {
    const mod = await importer();
    try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage diblokir: abaikan */ }
    return mod;
  } catch (err) {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* abaikan */ }
    if (Date.now() - last > 60000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* abaikan */ }
      window.location.reload();
      return new Promise(() => {}); // tunggu reload
    }
    throw err;
  }
});
