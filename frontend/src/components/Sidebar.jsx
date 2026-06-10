import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from "react";
import { getMenuTree } from "../services/menuService";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import SidebarMenu from "./SidebarMenu";

const SidebarItem = ({ item }) => {
  const location = useLocation();
  const isActive = location.pathname === item.component;
  const [open, setOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const toggleOpen = () => setOpen((prev) => !prev);

return (
    <div className="ml-2">
      <div
        className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer hover:bg-blue-100 ${
          isActive ? "bg-blue-200 font-bold" : ""
        }`}
        onClick={hasChildren ? toggleOpen : undefined}
      >
        <div className="flex items-center space-x-2">
          {item.icon && (
            <i className={`${item.icon} text-gray-600`}></i> // FontAwesome class
          )}
          {item.component ? (
            <Link to={item.component}>{item.menu}</Link>
          ) : (
            <span>{item.menu}</span>
          )}
        </div>

        {hasChildren && (
          <span className="text-gray-500">
            {open ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )}
          </span>
        )}
      </div>

      {hasChildren && open && (
        <div className="ml-4 border-l border-gray-200">
          {item.children.map((child) => (
            <SidebarItem key={child._id} item={child} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function Sidebar() {
  const [menus, setMenus] = useState([]);
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!user) return navigate('/login');
    loadMenus();
  }, []);

  const loadMenus = async () => {
    const res = await getMenuTree(user.token);
    setMenus(res);
  };

  return (
    <aside className="w-1/5 bg-gray-800 text-white border-r overflow-auto p-4">
      <h2 className="text-lg font-bold mb-4">Menu</h2>
      <nav className="space-y-2">
        <SidebarMenu items={menus}></SidebarMenu>
        
        {/* {menus.map((menu) => (
          <SidebarMenu key={menu._id} item={menu} />
        ))} */}
      </nav>
    </aside>
  );
}
