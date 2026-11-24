import { formatNumber, formatRupiah, variantLabel } from './formatHelper';
import { formatDate2 } from './dateHelper';
import { REASONS } from './stockMeta';

// Kolom DataTable untuk pergerakan stok (halaman Stock Movement & kartu stok produk)

/** Kolom masuk / keluar / saldo (dipakai halaman Stock Movement & kartu stok produk) */
export const qtyColumns = [
  {
    key: 'in',
    header: 'In',
    width: 100,
    className: 'text-right tabular-nums',
    render: (m) => (m.qty > 0 ? <span className="text-success-fg font-medium">{formatNumber(m.qty)}</span> : ''),
  },
  {
    key: 'out',
    header: 'Out',
    width: 100,
    className: 'text-right tabular-nums',
    render: (m) => (m.qty < 0 ? <span className="text-danger font-medium">{formatNumber(-m.qty)}</span> : ''),
  },
  {
    key: 'balanceAfter',
    header: 'Balance',
    width: 110,
    className: 'text-right tabular-nums font-semibold',
    render: (m) => `${formatNumber(m.balanceAfter)} ${m.produk?.uom?.code || ''}`,
  },
];

/** Kolom biaya (hanya jika API mengirim canSeeCost) */
export const costColumns = [
  {
    key: 'unitCost',
    header: 'Unit cost',
    width: 120,
    className: 'text-right tabular-nums',
    render: (m) => (m.unitCost === null || m.unitCost === undefined ? '-' : formatRupiah(m.unitCost)),
  },
  {
    key: 'value',
    header: 'Value',
    width: 140,
    className: 'text-right tabular-nums',
    render: (m) => (m.value === null || m.value === undefined ? '-' : (
      <span className={m.value < 0 ? 'text-danger' : 'text-success-fg'}>{formatRupiah(m.value)}</span>
    )),
  },
  {
    key: 'avgCostAfter',
    header: 'HPP after',
    width: 120,
    className: 'text-right tabular-nums text-muted',
    render: (m) => (m.avgCostAfter === null || m.avgCostAfter === undefined ? '-' : formatRupiah(m.avgCostAfter)),
  },
];

export const dateColumn = {
  key: 'date',
  header: 'Time',
  width: 150,
  sortField: 'date',
  render: (m) => <span className="tabular-nums">{formatDate2(m.date)}</span>,
};

export const skuColumn = {
  key: 'sku',
  header: 'SKU',
  width: 230,
  render: (m) => (
    <div className="min-w-0">
      <div className="font-mono text-xs font-semibold truncate">{m.sku?.sku || '(deleted)'}</div>
      <div className="text-xs text-muted truncate">{m.produk?.name} · {variantLabel(m.sku)}</div>
    </div>
  ),
};

export const reasonText = (m) => [REASONS[m.reason] || m.reason, m.note].filter(Boolean).join(' · ');
