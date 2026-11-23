import { useContext } from 'react';
import { ToastContext } from '../context/FeedbackContext';

/** toast.success(msg) / toast.error(msg) / toast.warning(msg) / toast.info(msg) */
export default function useToast() {
  return useContext(ToastContext);
}
