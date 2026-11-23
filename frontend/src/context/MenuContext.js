import { createContext } from 'react';

// Pohon menu dari /api/menu/tree, dipakai bersama oleh Sidebar dan judul halaman.
// Provider: context/MenuProvider.jsx, hook: hooks/useMenus.js
export const MenuContext = createContext({
  menus: [],
  loading: true,
  reloadMenus: () => {},
});
