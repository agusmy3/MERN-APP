import { createContext } from 'react';

// Provider: context/ToastProvider.jsx & context/ConfirmProvider.jsx
// Hook: hooks/useToast.js & hooks/useConfirm.js

/** { success(msg), error(msg), info(msg), warning(msg) } */
export const ToastContext = createContext(null);

/** confirm({ title, message, confirmLabel, cancelLabel, tone }) => Promise<boolean> */
export const ConfirmContext = createContext(null);
