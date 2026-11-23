import { useContext } from 'react';
import { ConfirmContext } from '../context/FeedbackContext';

/** const confirm = useConfirm(); const ok = await confirm({ title, message, confirmLabel, tone: 'danger' }); */
export default function useConfirm() {
  return useContext(ConfirmContext);
}
