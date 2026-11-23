import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import useMenus from './useMenus';
import useDocumentTitle from './useDocumentTitle';
import { findMenuTrail } from '../utils/menuTrail';

/**
 * Judul, subjudul, ikon, dan breadcrumb halaman diambil dari data Menu untuk route aktif,
 * supaya sama dengan nama di sidebar. Juga mengatur judul tab browser.
 *
 * `fallbackTitle` dipakai jika route tidak terdaftar di Menu atau data menu masih dimuat.
 *
 * Halaman turunan yang tidak ada di Menu (mis. detail /produk/:id) memberi:
 *   parentPath : route induk yang ada di Menu (mis. '/produk') -> breadcrumb & ikon diambil dari situ
 *   title      : judul halaman ini (mis. nama produk), ditambahkan di ujung breadcrumb
 */
export default function usePageMeta(fallbackTitle, { parentPath, title: childTitle } = {}) {
  const { pathname } = useLocation();
  const { menus } = useMenus();

  const trail = useMemo(() => {
    if (!parentPath) return findMenuTrail(menus, pathname);
    const parentTrail = findMenuTrail(menus, parentPath);
    // fallback jika induk belum ada di Menu: tetap tampilkan link ke induk
    const parents = parentTrail.length ? parentTrail : [{ _id: parentPath, menu: fallbackTitle, component: parentPath }];
    return [...parents, { _id: pathname, menu: childTitle || '…', component: null }];
  }, [menus, pathname, parentPath, childTitle, fallbackTitle]);

  const current = trail[trail.length - 1];
  const parent = parentPath ? trail[trail.length - 2] : null;

  const title = current?.menu || fallbackTitle;
  useDocumentTitle(title);

  return {
    title,
    // halaman turunan tidak memakai subjudul induknya
    subtitle: parentPath ? '' : current?.deskripsi || '',
    icon: (parentPath ? parent?.icon : current?.icon) || '',
    trail, // [root, ..., current]
  };
}
