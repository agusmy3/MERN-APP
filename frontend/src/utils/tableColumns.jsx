import { AuditCell } from '../components/AuditInfo';
import { AUDIT_SORT_OPTIONS } from './auditSort';

// Kolom standar yang dipakai semua halaman master data (DataTable `columns`).

/** Kolom "Last Modified" ringkas dengan menu sort created/updated. */
export const auditColumn = (sortField) => ({
  key: 'audit',
  header: 'Last Modified',
  width: 230,
  sortOptions: AUDIT_SORT_OPTIONS,
  render: (row) => <AuditCell row={row} sortField={sortField} />,
});

const ghostButton = 'w-8 h-8 rounded-md border cursor-pointer';

/**
 * Kolom tombol aksi sesuai izin (gaya ghost: ikon bergaris tipis, tanpa isi warna).
 * `crud` = hasil useCrudDrawer():
 *   Detail : selalu ada (halaman ini sudah butuh izin view) -> drawer baca saja
 *   Edit   : izin update (+ canEditRow)
 *   Delete : izin delete (+ canDeleteRow)
 * `options.onView` menimpa aksi Detail (mis. buka halaman detail, bukan drawer).
 */
export const actionColumn = (crud, { onView } = {}) => {
  const buttonCount = 1 + (crud.perm.canUpdate ? 1 : 0) + (crud.perm.canDelete ? 1 : 0);

  return {
    key: 'action',
    header: 'Action',
    width: 50 + buttonCount * 38,
    className: 'text-nowrap',
    render: (row) => (
      <div className="flex gap-1.5">
        <button
          type="button"
          title="Detail"
          aria-label="Detail"
          onClick={() => (onView ? onView(row) : crud.openView(row))}
          className={`${ghostButton} border-line text-muted hover:text-fg hover:bg-subtle`}
        >
          <i className='fa fa-eye text-xs'></i>
        </button>
        {crud.canUpdateRow(row) && (
          <button
            type="button"
            title="Edit"
            aria-label="Edit"
            onClick={() => crud.openEdit(row)}
            className={`${ghostButton} border-line text-muted hover:text-primary hover:border-primary hover:bg-primary-soft`}
          >
            <i className='fa fa-pen text-xs'></i>
          </button>
        )}
        {crud.canRemoveRow(row) && (
          <button
            type="button"
            title="Delete"
            aria-label="Delete"
            onClick={() => crud.handleDelete(row)}
            className={`${ghostButton} border-danger-line text-danger hover:bg-danger-soft`}
          >
            <i className='fa fa-trash text-xs'></i>
          </button>
        )}
      </div>
    ),
  };
};
