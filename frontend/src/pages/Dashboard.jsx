import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import dayjs from 'dayjs';
import { useAuth } from '../context/AuthContext';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/stock/StatusBadge';
import { ActionBadge } from '../components/audit/AuditChanges';
import { BarList, ColumnChart, InOutChart } from '../components/dashboard/Charts';
import { formatNumber, formatRupiah, formatRupiahCompact, formatCompact, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay } from '../utils/dateHelper';
import { ENTITY_META } from '../utils/auditFormat';
import { REORDER_STATUS } from '../utils/reorderMeta';
import usePermission from '../hooks/usePermission';

// widget peta memuat Leaflet: chunk terpisah
const MapWidget = lazy(() => import('../components/map/MapWidget'));

const getDashboard = async (token) => (await axios.get('/api/dashboard', {
  headers: { Authorization: `Bearer ${token}` },
  params: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
})).data.data;

function Card({ title, icon, action, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-fg">{icon && <i className={`fa ${icon} mr-2 text-muted`}></i>}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, to, icon, tone = '' }) {
  const body = (
    <>
      <div className="text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
        {icon && <i className={`fa ${icon}`}></i>}{label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1 text-fg">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </>
  );
  const cls = `block rounded-lg border p-4 min-w-0 ${tone || 'border-line bg-surface'}`;
  return to ? <Link to={to} className={`${cls} hover:border-primary`}>{body}</Link> : <div className={cls}>{body}</div>;
}

const moreLink = (to, label = 'View all') => (
  <Link to={to} className="text-xs text-primary hover:underline shrink-0">{label} <i className="fa fa-arrow-right"></i></Link>
);

/**
 * Dashboard: widget mengikuti izin user (backend hanya mengirim widget yang boleh dilihat).
 * Angka biaya (nilai persediaan, pembelian) hanya untuk user dengan vendorPrice:view.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);

  useEffect(() => {
    getDashboard(user.token)
      .then(setD)
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load dashboard'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  const pendingItems = d?.pending || d?.poDrafts !== undefined ? [
    ['stockAdjustment', 'Stock adjustment drafts', '/stock-adjustment', 'fa-boxes-stacked'],
    ['stockTransfer', 'Stock transfer drafts', '/stock-transfer?status=DRAFT', 'fa-truck-arrow-right'],
    ['transferIncoming', 'Transfers to receive', '/stock-transfer?status=IN_TRANSIT', 'fa-truck-fast'],
    ['goodsReceipt', 'Goods receipt drafts', '/goods-receipt', 'fa-truck-ramp-box'],
    ['costRevaluation', 'Cost revaluation drafts', '/cost-revaluation', 'fa-scale-balanced'],
    ['salesInvoice', 'Sales invoice drafts', '/sales-invoice?status=DRAFT', 'fa-file-invoice-dollar'],
    ['salesOrder', 'Sales order drafts', '/sales-order?status=DRAFT', 'fa-file-signature'],
    ['soToDeliver', 'Sales orders to deliver', '/sales-order?status=ACTIVE', 'fa-truck-fast'],
    ['deliveryOrder', 'Delivery order drafts', '/delivery-order?status=DRAFT', 'fa-truck-ramp-box'],
    ['doToInvoice', 'Deliveries to invoice', '/delivery-order?invoiced=false', 'fa-file-invoice-dollar'],
    ['grToBill', 'Goods receipts not billed', '/goods-receipt?billed=false', 'fa-file-invoice-dollar'],
    ['purchaseReturn', 'Purchase return drafts', '/purchase-return', 'fa-truck-arrow-right'],
  ].filter(([k]) => d?.pending?.[k] !== undefined).map(([k, label, to, icon]) => ({ key: k, label, to, icon, count: d.pending[k] })) : [];
  if (d?.poDrafts !== undefined) pendingItems.push({ key: 'poDrafts', label: 'Purchase order drafts', to: '/purchase-order', icon: 'fa-file-invoice', count: d.poDrafts });

  const mapPerm = usePermission('map');
  const hasAnything = d && (mapPerm.canView || Object.keys(d).some((k) => k !== 'canSeeCost'));

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader fallbackTitle="Dashboard" subtitle={`Selamat datang, ${user?.name || 'User'}!`} />

      {!d ? (
        <div className="p-6 text-muted">Loading...</div>
      ) : !hasAnything ? (
        <p className="text-muted">Belum ada widget untuk role Anda. Gunakan menu di sidebar.</p>
      ) : (
        <div className="space-y-4">
          {/* ---------- KPI ---------- */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            {d.sales && (
              <>
                <Kpi label="Sales today" icon="fa-cash-register" value={formatRupiahCompact(d.sales.today.value)} to="/sales-invoice?status=POSTED"
                  sub={`${d.sales.today.count} invoice${d.sales.today.grossProfit !== undefined ? ` · GP ${formatRupiahCompact(d.sales.today.grossProfit)}` : ''}`} />
                <Kpi label="Sales this month" icon="fa-chart-line" value={formatRupiahCompact(d.sales.month.value)} to="/sales-invoice?status=POSTED"
                  sub={`${d.sales.month.count} invoice${d.sales.month.grossProfit !== undefined ? ` · GP ${formatRupiahCompact(d.sales.month.grossProfit)}` : ''}`} />
              </>
            )}
            {d.receivables && (
              <Kpi label="Receivables" icon="fa-hand-holding-dollar" value={formatRupiahCompact(d.receivables.outstanding)}
                to={d.receivables.overdueCount ? '/sales-invoice?paymentStatus=OVERDUE' : '/sales-invoice?paymentStatus=OPEN'}
                sub={`${d.receivables.count} invoice${d.receivables.overdueCount ? ` · ${formatRupiahCompact(d.receivables.overdue)} overdue (${d.receivables.overdueCount})` : ''}${d.receivables.deposits ? ` · deposit ${formatRupiahCompact(d.receivables.deposits)}` : ''}`}
                tone={d.receivables.overdueCount ? 'border-danger-line bg-danger-soft' : ''} />
            )}
            {d.agedDeposits?.customer?.count > 0 && (
              <Kpi label="Old customer deposits" icon="fa-piggy-bank" value={formatRupiahCompact(d.agedDeposits.customer.amount)} to="/customer-deposit?show=aged"
                sub={`${d.agedDeposits.customer.count} deposit > ${d.agedDeposits.customer.days} hari belum dipakai`}
                tone="border-warning-fg/40 bg-warning-soft" />
            )}
            {d.agedDeposits?.vendor?.count > 0 && (
              <Kpi label="Old vendor deposits" icon="fa-vault" value={formatRupiahCompact(d.agedDeposits.vendor.amount)} to="/vendor-deposit?show=aged"
                sub={`${d.agedDeposits.vendor.count} uang muka > ${d.agedDeposits.vendor.days} hari: pakai, tagih, atau konfirmasi`}
                tone="border-warning-fg/40 bg-warning-soft" />
            )}
            {d.payables && (
              <Kpi label="Payables" icon="fa-money-check-dollar" value={formatRupiahCompact(d.payables.outstanding)}
                to={d.payables.overdueCount ? '/purchase-invoice?paymentStatus=OVERDUE' : '/purchase-invoice?paymentStatus=OPEN'}
                sub={`${d.payables.count} bill${d.payables.overdueCount ? ` · ${formatRupiahCompact(d.payables.overdue)} overdue (${d.payables.overdueCount})` : ''}${d.payables.dueSoon ? ` · ${formatRupiahCompact(d.payables.dueSoon)} due ≤ 7 days` : ''}`}
                tone={d.payables.overdueCount ? 'border-danger-line bg-danger-soft' : ''} />
            )}
            {d.inventoryValue !== undefined && (
              <Kpi label="Inventory value" icon="fa-sack-dollar" value={formatRupiahCompact(d.inventoryValue)} to="/stock-valuation"
                sub={`${formatRupiah(d.inventoryValue)}${d.inTransit?.value ? ` · + ${formatRupiahCompact(d.inTransit.value)} in transit` : ''}`} />
            )}
            {d.activeSkus !== undefined && <Kpi label="Active SKU" icon="fa-layer-group" value={formatNumber(d.activeSkus)} to="/produk" />}
            {d.reorder && (
              <Kpi label="Need reorder" icon="fa-bell" value={formatNumber(d.reorder.needAction)} to="/reorder"
                sub={`${d.reorder.OUT} out · ${d.reorder.CRITICAL} critical · ${d.reorder.ORDERED} on order`}
                tone={d.reorder.needAction ? 'border-danger-line bg-danger-soft' : ''} />
            )}
            {d.openPo && (
              <Kpi label="Open PO" icon="fa-file-invoice" value={formatNumber(d.openPo.count)} to="/purchase-order"
                sub={`Outstanding ${formatRupiahCompact(d.openPo.outstandingValue)}${d.overduePo?.count ? ` · ${d.overduePo.count} overdue` : ''}`} />
            )}
            {d.skuWithoutHpp !== undefined && (
              <Kpi label="SKU without HPP" icon="fa-triangle-exclamation" value={formatNumber(d.skuWithoutHpp)}
                sub={d.skuWithoutHpp ? 'Nilai persediaan belum lengkap' : 'Semua SKU berstok punya HPP'}
                to={d.skuWithoutHpp ? '/cost-revaluation/new?missing=1' : undefined}
                tone={d.skuWithoutHpp ? 'border-warning-fg/40 bg-warning-soft' : ''} />
            )}
          </div>

          {mapPerm.canView && (
            <Suspense fallback={null}>
              <MapWidget />
            </Suspense>
          )}

          {/* ---------- pekerjaan & reorder ---------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            {(pendingItems.length > 0 || d.overduePo) && (
              <Card title="Pending work" icon="fa-list-check">
                <ul className="divide-y divide-line-soft">
                  {pendingItems.map((p) => (
                    <li key={p.key}>
                      <Link to={p.to} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                        <span className="text-sm"><i className={`fa ${p.icon} w-5 text-muted`}></i>{p.label}</span>
                        <span className={`tabular-nums text-sm font-semibold ${p.count ? 'text-fg' : 'text-muted'}`}>{p.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {d.overduePo?.items.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-danger mb-1">
                      <i className="fa fa-clock mr-1"></i>Overdue PO ({d.overduePo.count})
                    </div>
                    <ul className="space-y-1 text-sm">
                      {d.overduePo.items.map((po) => (
                        <li key={po._id} className="flex items-center justify-between gap-2">
                          <Link to={`/purchase-order/${po._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{po.no}</Link>
                          <span className="truncate text-muted">{po.vendor?.companyName}</span>
                          <span className="text-xs text-danger shrink-0">ETA {formatDay(po.expectedDate)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}

            {d.reorder && (
              <Card title="Reorder alert" icon="fa-bell" action={moreLink('/reorder')}>
                {d.reorder.items.length ? (
                  <ul className="divide-y divide-line-soft">
                    {d.reorder.items.map((r) => (
                      <li key={`${r.sku._id}:${r.gudang._id}`} className="flex items-center justify-between gap-3 py-1.5">
                        <div className="min-w-0">
                          <Link to={`/produk/${r.produk._id}?tab=stock&sku=${r.sku._id}&gudang=${r.gudang._id}`} className="font-mono text-xs font-semibold hover:text-primary hover:underline">{r.sku.sku}</Link>
                          <div className="text-xs text-muted truncate">{r.produk.name} · {variantLabel(r.sku)} · {r.gudang.code}</div>
                        </div>
                        <span className="text-xs tabular-nums text-muted shrink-0">{formatNumber(r.onHand)} / min {formatNumber(r.minQty)} {r.uom}</span>
                        <StatusBadge status={r.status} meta={REORDER_STATUS} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted py-4 text-center"><i className="fa fa-check mr-1 text-success-fg"></i>Tidak ada SKU yang perlu dipesan.</p>}
              </Card>
            )}
          </div>

          {/* ---------- grafik ---------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            {d.salesByMonth && (
              <Card title="Net sales (excl. PPN), last 6 months" icon="fa-chart-line" action={moreLink('/sales-invoice')}>
                <ColumnChart
                  ariaLabel="Net sales per month"
                  points={d.salesByMonth.map((p) => ({ key: p.key, label: dayjs(`${p.key}-01`).format('MMM YY'), value: p.value }))}
                  format={formatRupiahCompact}
                />
              </Card>
            )}
            {d.topProducts && (
              <Card title="Top products, last 30 days" icon="fa-ranking-star">
                {d.topProducts.length ? (
                  <BarList items={d.topProducts.map((p) => ({ key: p.id, label: p.label, sub: `${p.name} · ${formatNumber(p.qty)} sold`, value: p.value }))} format={formatRupiahCompact} />
                ) : <p className="text-sm text-muted py-4 text-center">Belum ada penjualan 30 hari terakhir.</p>}
              </Card>
            )}
            {d.valueByGudang && (
              <Card title="Inventory value by warehouse" icon="fa-warehouse" action={moreLink('/stock-valuation', 'Valuation')}>
                <BarList items={d.valueByGudang.map((g) => ({ key: g.id, label: g.label, sub: g.name, value: g.value }))} format={formatRupiahCompact} />
              </Card>
            )}
            {d.valueByKategori && (
              <Card title="Inventory value by category (top 8)" icon="fa-tags">
                <BarList items={d.valueByKategori.map((k) => ({ key: k.id || k.label, label: k.label, value: k.value }))} format={formatRupiahCompact} />
              </Card>
            )}
            {d.purchasesByMonth && (
              <Card title="Purchases (goods received), last 6 months" icon="fa-truck-ramp-box">
                <ColumnChart
                  ariaLabel="Purchase value per month"
                  points={d.purchasesByMonth.map((p) => ({ key: p.key, label: dayjs(`${p.key}-01`).format('MMM YY'), value: p.value }))}
                  format={formatRupiahCompact}
                />
              </Card>
            )}
            {d.movementsByDay && (
              <Card title="Stock movement, last 30 days (qty)" icon="fa-right-left" action={moreLink('/stock-movement')}>
                <InOutChart
                  ariaLabel="Stock in and out per day"
                  points={d.movementsByDay.map((p) => ({ key: p.key, label: dayjs(p.key).format('DD MMM'), in: p.in, out: p.out }))}
                  format={formatCompact}
                />
              </Card>
            )}
          </div>

          {/* ---------- aktivitas ---------- */}
          {d.recentActivity && (
            <Card title="Recent activity" icon="fa-clock-rotate-left" action={moreLink('/audit-log')}>
              <ul className="divide-y divide-line-soft">
                {d.recentActivity.map((l) => (
                  <li key={l._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                    <span className="text-xs text-muted tabular-nums w-32 shrink-0">{formatDate2(l.date)}</span>
                    <ActionBadge action={l.action} />
                    <span className="text-muted"><i className={`fa ${ENTITY_META[l.entity]?.icon || 'fa-circle'} mr-1 text-xs`}></i>{ENTITY_META[l.entity]?.label || l.entity}</span>
                    <span className="font-medium truncate max-w-64">{l.entityLabel}</span>
                    <span className="text-muted ml-auto text-xs">{l.userName}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
