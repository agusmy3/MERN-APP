import { useContext } from 'react';
import { MenuContext } from '../context/MenuContext';

/** { menus, loading, reloadMenus } dari MenuProvider */
export default function useMenus() {
  return useContext(MenuContext);
}
