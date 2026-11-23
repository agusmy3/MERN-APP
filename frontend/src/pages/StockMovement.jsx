import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getStockMovements } from '../services/stockService';
import { getGudangDropdown } from '../services/gudangService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import { MovementRef, MovementType } from '../components/stock/MovementCells';
import { dateColumn, qtyColumns, reasonText, skuColumn } from '../utils/movementColumns';
import { inputClass } from '../utils/formStyles';
import { MOVEMENT_TYPES } from '../utils/stockMeta';

const selectClass = `${inputClass} sm:w-auto`;

/**
 * Laporan pergerakan stok (kartu stok global, baca saja; izin stockMovement:view).
 * Query URL awal: ?search=<no. dokumen / SKU>&gudang=&sku=&produk= (dari halaman lain).
 */
export default function StockMovement() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [gudangList, setGudangList] = useState([]);
  const [filters, setFilters] = useState(() => ({
    gudang: searchParams.get('gudang') || '',
    type: '',
    from: '',
    to: '',
    // filter dari halaman lain (detail produk), tampil sebagai chip
    sku: searchParams.get('sku') || '',
    produk: searchParams.get('produk') || '',
  }));
  const scopeLabel = searchParams.get('label');

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  const fetchMovements = useCallback(async ({ search, page, pageSize, sortOrder }) => {
    const params = { search, page, pageSize, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getStockMovements(user.token, params);
    return { items: data.dataMovement, total: data.totalData };
  }, [user.token, filters]);

  const table = useDataTable(fetchMovements, { defaultSortField: 'date', defaultPageSize: 20 });
  const { setSearchInput } = table;

  // isi pencarian dari URL sekali saat dibuka (mis. dari dokumen: ?search=ADJ-202611-0001)
  useEffect(() => {
    const initial = searchParams.get('search');
    if (initial) setSearchInput(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };
  const clearScope = () => {
    setFilters((f) => ({ ...f, sku: '', produk: '' }));
    setSearchParams({}, { replace: true });
    table.setCurrentPage(1);
  };
  const hasFilter = ['gudang', 'type', 'from', 'to'].some((k) => filters[k]) || table.searchInput;

  const columns = [
    dateColumn,
    { key: 'ref', header: 'Document', width: 160, render: (m) => <MovementRef m={m} /> },
    { key: 'type', header: 'Type', width: 170, render: (m) => <MovementType m={m} /> },
    skuColumn,
    { key: 'gudang', header: 'Warehouse', width: 110, render: (m) => m.gudang?.code || '-' },
    ...qtyColumns,
    { key: 'reason', header: 'Reason / Note', width: 240, render: reasonText },
    { key: 'user', header: 'User', width: 140, render: (m) => m.createdBy?.name || '' },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader fallbackTitle="Stock Movement" />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search SKU code, document no..."
              aria-label="Search stock movement"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => setFilter('gudang', e.target.value)} className={selectClass}>
            <option value="">All warehouses</option>
            {gudangList.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
          </select>
          <select aria-label="Type" value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className={selectClass}>
            <option value="">All types</option>
            {Object.entries(MOVEMENT_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined}
              onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
            <span className="text-muted text-sm">–</span>
            <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined}
              onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
          </div>
          {(filters.sku || filters.produk) && (
            <span className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded bg-primary-soft text-primary-soft-fg">
              {scopeLabel || (filters.sku ? 'Selected SKU' : 'Selected product')}
              <button type="button" aria-label="Clear SKU / product filter" onClick={clearScope} className="cursor-pointer">
                <i className="fa fa-xmark"></i>
              </button>
            </span>
          )}
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setFilters((f) => ({ ...f, gudang: '', type: '', from: '', to: '' }));
                table.setSearchInput('');
                table.setCurrentPage(1);
              }}
              className="text-sm text-muted hover:text-fg cursor-pointer"
            >
              <i className="fa fa-xmark"></i> Reset
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          data={table.items}
          sortField={table.sortField}
          sortOrder={table.sortOrder}
          onSort={table.toggleSort}
          startIndex={table.startIndex}
          loading={table.loading}
          emptyText="No stock movement"
        />

        <Pagination
          currentPage={table.currentPage}
          totalItems={table.totalItems}
          pageSize={table.pageSize}
          onPageChange={table.setCurrentPage}
          onPageSizeChange={table.setPageSize}
        />
      </div>
    </div>
  );
}
