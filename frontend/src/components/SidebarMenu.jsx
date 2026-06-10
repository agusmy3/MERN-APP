import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";

const SidebarMenu = ({ items }) => {
  return (
    // <div className="w-64 bg-gray-800 text-white h-screen overflow-y-auto">
      <ul className="space-y-1 p-2">
        {items.map((item) => (
          <MenuItem key={item._id} item={item} />
        ))}
      </ul>
    // </div>
  );
};

const MenuItem = ({ item }) => {
  const [open, setOpen] = useState(false);
    const isActive = location.pathname === item.component;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <li>
      <div
        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-gray-700 ${
          open || isActive ? "bg-gray-700 font-bold" : ""
        }`}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <div className="flex items-center space-x-3">
          {item.icon && <i className={`${item.icon} w-5 text-gray-300`}></i>}
          {item.component ? (
            <Link to={item.component}>{item.menu}</Link>
          ) : (
            <span>{item.menu}</span>
          )}
        </div>

        {hasChildren && (
          <i
            className={`fas fa-chevron-${
              open ? "down" : "right"
            } text-gray-400 text-xs`}
          ></i>
        )}
      </div>

      <AnimatePresence>
        {open && hasChildren && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="pl-6 mt-1 space-y-1"
          >
            {item.children.map((child) => (
              <MenuItem key={child._id} item={child} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
};

export default SidebarMenu;
