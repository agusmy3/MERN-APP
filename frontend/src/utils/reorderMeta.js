/** Status reorder alert (key sama dengan backend controllers/reorderController.js) */
export const REORDER_STATUS = {
  OUT: { label: 'Out of stock', icon: 'fa-circle-xmark', tone: 'bg-danger-soft text-danger' },
  CRITICAL: { label: 'Critical', icon: 'fa-triangle-exclamation', tone: 'bg-warning-soft text-warning-fg' },
  ORDERED: { label: 'On order', icon: 'fa-truck', tone: 'bg-primary-soft text-primary-soft-fg' },
  OK: { label: 'OK', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
};
