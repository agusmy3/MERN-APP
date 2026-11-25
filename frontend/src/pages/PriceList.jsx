import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPriceLists } from '../services/salesService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import { AuditCell } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';

/** Daftar Price List (harga jual khusus). Customer ditautkan ke price list di form Customer. */
export default function PriceList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('priceList');

  const fetchDocs = useCallback(async (params) => {
    const data = await getPriceLists(user.token, params);
    return { items: data.dataPriceList, total: data.totalData };
  }, [user.token]);
  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });

  const columns = [
    {
      key: 'code',
      header: 'Code',
      width: 140,
      sortField: 'code',
      render: (d) => <Link to={`/price-list/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.code}</Link>,
    },
    { key: 'name', header: 'Name', width: 220, sortField: 'name' },
    { key: 'itemCount', header: 'SKU', width: 90, className: 'text-right tabular-nums', render: (d) => formatNumber(d.itemCount) },
    { key: 'customerCount', header: 'Customers', width: 110, className: 'text-right tabular-nums', render: (d) => formatNumber(d.customerCount) },
    {
      key: 'isActive',
      header: 'Status',
      width: 110,
      render: (d) => (d.isActive !== false
        ? <span className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-fg">Active</span>
        : <span className="text-xs px-2 py-0.5 rounded bg-subtle text-muted">Inactive</span>),
    },
    { key: 'deskripsi', header: 'Description', width: 260 },
    {
      key: 'audit',
      header: 'Last Modified',
      width: 230,
      sortOptions: AUDIT_SORT_OPTIONS,
      render: (d) => <AuditCell row={d} sortField={table.sortField} />,
    },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (d) => (
        <button type="button" title="Open" aria-label={`Open ${d.code}`} onClick={() => navigate(`/price-list/${d._id}`)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer">
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Price List"
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate('/price-list/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> New Price List
          </button>
        )}
      />
      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 relative max-w-sm">
          <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
          <input type="search" placeholder="Search code, name..." aria-label="Search price list" value={table.searchInput}
            onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
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
          emptyText="No price list"
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
