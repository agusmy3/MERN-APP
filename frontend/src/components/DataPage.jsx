import DataTable from './DataTable';
import Pagination from './Pagination';
import PageHeader from './PageHeader';
import { inputClass } from '../utils/formStyles';

/**
 * Kerangka halaman master data: header (breadcrumb, judul, subjudul dari data Menu),
 * toolbar (search + tombol Add sejajar), tabel, dan pagination.
 * Drawer form diletakkan sebagai `children`.
 *
 * `table` adalah hasil useDataTable().
 * `fallbackTitle` dipakai jika route belum terdaftar di Menu (atau menu masih dimuat).
 */
export default function DataPage({
  fallbackTitle,
  entityName,
  onAdd,
  table,
  columns,
  highlightKey = null,
  children,
}) {
  const entity = entityName.toLowerCase();

  return (
    <div className='h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden'>
      <PageHeader fallbackTitle={fallbackTitle} />

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        {/* toolbar: search di kiri, tombol Add di kanan, sejajar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-48 max-w-md">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder={`Search ${entity}...`}
              aria-label={`Search ${entity}`}
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          {/* onAdd null = tidak punya izin create (lihat useCrudDrawer.addHandler) */}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="shrink-0 bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded cursor-pointer"
            >
              <i className="fa fa-plus"></i> Add {entityName}
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          data={table.items}
          sortField={table.sortField}
          sortOrder={table.sortOrder}
          onSort={table.toggleSort}
          onSortSelect={table.setSort}
          startIndex={table.startIndex}
          loading={table.loading}
          emptyText={`No ${entity} data`}
          highlightKey={highlightKey}
        />

        <Pagination
          currentPage={table.currentPage}
          totalItems={table.totalItems}
          pageSize={table.pageSize}
          onPageChange={table.setCurrentPage}
          onPageSizeChange={table.setPageSize}
        />
      </div>

      {children}
    </div>
  );
}
