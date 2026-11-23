/**
 * Cari jalur menu dari root sampai menu yang `component`-nya sama dengan `pathname`.
 * Mengembalikan array [root, ..., menu] atau [] jika tidak ditemukan.
 */
export const findMenuTrail = (menus, pathname) => {
  for (const menu of menus || []) {
    if (menu.component === pathname) return [menu];
    const childTrail = findMenuTrail(menu.children, pathname);
    if (childTrail.length) return [menu, ...childTrail];
  }
  return [];
};
