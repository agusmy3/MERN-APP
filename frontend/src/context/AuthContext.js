import { createContext, useContext } from 'react';

/**
 * State login (provider: AuthProvider.jsx, dipasang di main.jsx). Dipisah dari provider supaya file komponen
 * hanya mengekspor komponen (Vite Fast Refresh / eslint react-refresh/only-export-components).
 * useAuth() -> { user, login, logout, updateUser, refreshUser, sessionExpired }
 */
export const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);
