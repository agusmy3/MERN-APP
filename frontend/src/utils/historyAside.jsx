import AuditHistorySection from '../components/audit/AuditHistorySection';

/**
 * Bagian History untuk drawer halaman master data (mode Detail/Edit, bukan Add):
 *   <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'kategori')}>
 * `entity` = key log di backend (helpers/auditLogger.js), harus terdaftar di HISTORY_ENTITIES.
 */
export const historyAside = (crud, entity, scopes) => (
  crud.mode !== 'create' && crud.editingRow
    ? <AuditHistorySection key={crud.editingRow._id} entity={entity} id={crud.editingRow._id} scopes={scopes} />
    : null
);
