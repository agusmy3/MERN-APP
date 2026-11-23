import { useContext } from 'react';
import { ThemeContext } from '../context/ThemeContext';

/** { theme, setTheme(id) } dari ThemeProvider. setTheme menyimpan ke akun user dan bisa throw. */
export default function useTheme() {
  return useContext(ThemeContext);
}
