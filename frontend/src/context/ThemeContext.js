import { createContext } from 'react';
import { DEFAULT_THEME } from '../theme/themes';

// Provider: context/ThemeProvider.jsx, hook: hooks/useTheme.js
export const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  setTheme: async () => {},
});
