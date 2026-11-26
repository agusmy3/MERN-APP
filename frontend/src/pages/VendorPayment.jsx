import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVendorPayments } from '../services/purchaseService';
import { getVendorDropdown } from '../services/vendorService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import { AuditCell } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatDay } from '../utils/dateHelper';
import { formatRupiah } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { PAYMENT_TYPES } from '../utils/salesMeta';
import { VENDOR_PAYMENT_METHODS } from '../utils/purchaseMeta';

const EMPTY_FILTERS = { status: 'POSTED', type: '', method: '', vendor: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/**
 * Daftar pembayaran ke vendor & refund dari vendor. Mencatat / membatalkan dilakukan di halaman tagihan vendor.
 * Total bersih = pembayaran - refund yang masih berlaku (sesuai filter).
 */
export default function VendorPayment() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [vendorList, setVendorList] = useState([]);
  const [totalNet, setTotalNet] = useState(null);

  useEffect(() => {
    getVendorDropdown(user.token).then(setVendorList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getVendorPayments(user.token, params);
    setTotalNet(data.totalNet);
    return { items: data.dataVendorPayment, total: data.totalData };
  }, [user.token, filters]);

  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });
  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };
  const hasFilter = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) || table.searchInput;

  const columns = [
    { key: 'no', header: 'No.', width: 165, sortField: 'no', className: 'font-mono text-sm font-semibold' },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    {
      key: 'bill',
      header: 'Vendor bill',
      width: 170,
      render: (d) => (d.purchaseInvoice ? (
        <span>
          <Link to={`/purchase-invoice/${d.purchaseInvoice._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{d.purchaseInvoice.no}</Link>
          {d.purchaseInvoice.vendorInvoiceNo && <div className="text-xs text-muted">{d.purchaseInvoice.vendorInvoiceNo}</div>}
        </span>
      ) : '-'),
    },
    { key: 'vendor', header: 'Vendor', width: 200, render: (d) => d.vendor?.companyName || '-' },
    { key: 'type', header: 'Type', width: 100, render: (d) => <span className={d.type === 'REFUND' ? 'text-success-fg' : ''}>{PAYMENT_TYPES[d.type]}</span> },
    { key: 'method', header: 'Method', width: 110, render: (d) => VENDOR_PAYMENT_METHODS[d.method] || d.method },
    {
      key: 'amount',
      header: 'Amount',
      width: 150,
      sortField: 'amount',
      className: 'text-right tabular-nums',
      render: (d) => (
        <span className={d.status === 'CANCELLED' ? 'line-through text-muted' : ''}>
          {d.type === 'REFUND' ? '−' : ''}{formatRupiah(d.amount)}
        </span>
      ),
    },
    { key: 'reference', header: 'Reference', width: 160 },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (d) => (d.status === 'CANCELLED'
        ? <span className="text-xs px-2 py-0.5 rounded bg-danger-soft text-danger" title={d.cancelReason}>Cancelled</span>
        : <span className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-fg">Posted</span>),
    },
    { key: 'note', header: 'Note', width: 200 },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Vendor Payment"
        actions={totalNet !== null && filters.status !== 'CANCELLED' && (
          <div className="text-sm text-muted">Net paid: <b className="text-fg tabular-nums">{formatRupiah(totalNet)}</b></div>
        )}
      />
      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder="Search no., bill, vendor, reference..." aria-label="Search vendor payment"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            <option value="POSTED">Posted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select aria-label="Type" value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className={selectClass}>
            <option value="">All types</option>
            {Object.entries(PAYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Method" value={filters.method} onChange={(e) => setFilter('method', e.target.value)} className={selectClass}>
            <option value="">All methods</option>
            {Object.entries(VENDOR_PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Vendor" value={filters.vendor} onChange={(e) => setFilter('vendor', e.target.value)} className={selectClass}>
            <option value="">All vendors</option>
            {vendorList.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined}
              onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
            <span className="text-muted text-sm">–</span>
            <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined}
              onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
          </div>
          {hasFilter && (
            <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); table.setSearchInput(''); table.setCurrentPage(1); }}
              className="text-sm text-muted hover:text-fg cursor-pointer">
              <i className="fa fa-xmark"></i> Reset
            </button>
          )}
        </div>
        <DataTable columns={columns} data={table.items} sortField={table.sortField} sortOrder={table.sortOrder}
          onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No vendor payment" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
    </div>
  );
}
