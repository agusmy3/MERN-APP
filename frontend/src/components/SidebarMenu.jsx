import { useEffect, useState } from "react";
// alias kapital supaya dikenali ESLint no-unused-vars saat dipakai sebagai <Motion.ul>
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

// menu cocok dengan path yang dibuka, termasuk halaman turunannya (mis. menu /produk aktif di /produk/123)
const matchesPath = (component, pathname) =>
  !!component && (component === pathname || (component !== "/" && pathname.startsWith(`${component}/`)));

// true jika salah satu turunan (anak, cucu, dst.) menunjuk ke path yang sedang dibuka
const hasActiveDescendant = (item, pathname) =>
  (item.children || []).some(
    (child) => matchesPath(child.component, pathname) || hasActiveDescendant(child, pathname)
  );

const SidebarMenu = ({ items }) => {
  return (
    <ul className="space-y-1 p-2">
      {items.map((item) => (
        <MenuItem key={item._id} item={item} />
      ))}
    </ul>
  );
};

const MenuItem = ({ item }) => {
  const { pathname } = useLocation();
  const isActive = matchesPath(item.component, pathname);
  const hasChildren = item.children && item.children.length > 0;
  const containsActive = hasChildren && hasActiveDescendant(item, pathname);
  const [open, setOpen] = useState(containsActive);

  // Buka otomatis parent dari menu yang sedang aktif (mis. setelah navigasi)
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  // menu aktif: latar lebih terang + garis penanda di kiri (warna side-bar dari tema)
  let stateClass = '';
  if (isActive) {
    stateClass = `bg-side-active text-side-active-fg font-semibold
      before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-side-bar`;
  } else if (open) {
    stateClass = 'text-side-active-fg';
  }
  const rowClass = `relative flex items-center justify-between px-3 py-2 rounded-md cursor-pointer hover:bg-side-hover ${stateClass}`;

  const toggle = (e) => {
    // supaya klik chevron pada menu yang juga punya link tidak ikut berpindah halaman
    e.preventDefault();
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  const content = (
    <>
      <div className="flex items-center space-x-3">
        {item.icon && <i className={`${item.icon} w-5 text-center opacity-80`}></i>}
        <span>{item.menu}</span>
      </div>

      {hasChildren && (
        <span role="button" aria-label="Toggle submenu" onClick={toggle} className="px-1">
          <i className={`fas fa-chevron-${open ? "down" : "right"} text-side-muted text-xs`}></i>
        </span>
      )}
    </>
  );

  return (
    <li>
      {item.component ? (
        // seluruh baris bisa diklik, bukan hanya teksnya
        <Link
          to={item.component}
          className={rowClass}
          aria-current={isActive ? "page" : undefined}
          onClick={() => hasChildren && setOpen(true)}
        >
          {content}
        </Link>
      ) : (
        <div className={rowClass} onClick={toggle}>
          {content}
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && hasChildren && (
          <Motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="pl-6 mt-1 space-y-1 overflow-hidden"
          >
            {item.children.map((child) => (
              <MenuItem key={child._id} item={child} />
            ))}
          </Motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
};

export default SidebarMenu;
