import { useEffect } from 'react';

export const APP_NAME = 'MERN App';

/** Set judul tab browser: "<title> · MERN App" (atau nama aplikasi saja jika title kosong). */
export default function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
