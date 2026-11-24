import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStockMovements } from '../../services/stockService';
import SideDrawer from '../SideDrawer';
import { MovementRef, MovementType } from '../stock/MovementCells';
import { formatNumber, formatRupiah, formatSigned, round2, variantLabel } from '../../utils/formatHelper';
import { formatDate2 } from '../../utils/dateHelper';
import { reasonText } from '../../utils/movementColumns';
import { inputClass } from '../../utils/formStyles';

const PAGE_SIZE = 20;

/**
 * Kartu stok 1 SKU (1 gudang atau semua gudang) dalam drawer kanan.
 * Pemilih SKU & gudang di dalam drawer -> pindah tanpa menutup (onSelect mengubah URL).
 * Kolom ringkas: Waktu · Dokumen (+ jenis & alasan) · [Gudang] · Qty bertanda · Saldo.
 */
export default function StockCardDrawer({ open, token, skus, gudangs, skuId, gudangId, currentQty, uom, refreshKey, onSelect, onClose }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [canSeeCost, setCanSeeCost] = useState(false);

  const sku = skus.find((s) => s._id === skuId);
  const gudang = gudangs.find((g) => g._id === gudangId) || null;

  const fetchPage = useCallback(async (p) => {
    if (!skuId) return;
    setLoading(true);
    try {
      const params = { sku: skuId, page: p, pageSize: PAGE_SIZE };
      if (gudangId) params.gudang = gudangId;
      const data = await getStockMovements(token, params);
      setRows((prev) => (p === 1 ? data.dataMovement : [...prev, ...data.dataMovement]));
      setTotal(data.totalData);
      setCanSeeCost(!!data.canSeeCost);
      setPage(p);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, skuId, gudangId]);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    fetchPage(1);
  }, [open, fetchPage, refreshKey]);

  const totalIn = rows.reduce((sum, m) => (m.qty > 0 ? round2(sum + m.qty) : sum), 0);
  const totalOut = rows.reduce((sum, m) => (m.qty < 0 ? round2(sum + m.qty) : sum), 0);
  const label = sku ? `${sku.sku}${gudang ? ` @ ${gudang.code}` : ''}` : '';
  const moreParams = sku && new URLSearchParams({ sku: sku._id, label, ...(gudang ? { gudang: gudang._id } : {}) });

  const selectClass = `${inputClass} py-1.5`;

  return (
    <SideDrawer
      open={open && !!sku}
      onClose={onClose}
      title={<>Stock card: <span className="font-mono">{sku?.sku}</span></>}
      subtitle={sku && `${variantLabel(sku)} · ${gudang ? `${gudang.code} — ${gudang.name}` : 'all warehouses'}`}
      header={sku && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <select aria-label="SKU" value={skuId} onChange={(e) => onSelect(e.target.value, gudangId)} className={selectClass}>
              {skus.map((s) => <option key={s._id} value={s._id}>{s.sku} · {variantLabel(s)}</option>)}
            </select>
            <select aria-label="Warehouse" value={gudangId || ''} onChange={(e) => onSelect(skuId, e.target.value || null)} className={selectClass}>
              <option value="">All warehouses</option>
              {gudangs.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
            </select>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded border border-line px-3 py-2">
              <dt className="text-xs text-muted">Current stock</dt>
              <dd className="font-semibold tabular-nums">{formatNumber(currentQty)} {uom}</dd>
            </div>
            <div className="rounded border border-line px-3 py-2">
              <dt className="text-xs text-muted">In <span className="text-muted/70">(loaded)</span></dt>
              <dd className="font-semibold tabular-nums text-success-fg">{formatSigned(totalIn)}</dd>
            </div>
            <div className="rounded border border-line px-3 py-2">
              <dt className="text-xs text-muted">Out <span className="text-muted/70">(loaded)</span></dt>
              <dd className="font-semibold tabular-nums text-danger">{formatSigned(totalOut)}</dd>
            </div>
          </dl>
        </>
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-2 text-xs text-muted">
        <span>{rows.length} / {total} movement · terbaru di atas · saldo = saldo {gudang ? 'gudang ini' : 'gudang terkait'} setelah pergerakan</span>
        {moreParams && (
          <Link to={`/stock-movement?${moreParams}`} className="shrink-0 text-primary hover:underline">
            <i className="fa fa-arrow-up-right-from-square mr-1"></i>Stock Movement
          </Link>
        )}
      </div>

      <table className="w-full text-sm border-separate border-spacing-0">
        <thead className="bg-head text-head-fg text-left">
          <tr>
            <th className="px-2 py-2 border-b border-line font-semibold w-32">Time</th>
            <th className="px-2 py-2 border-b border-line font-semibold">Document</th>
            {!gudang && <th className="px-2 py-2 border-b border-line font-semibold w-20">Whs.</th>}
            <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Qty</th>
            <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m._id} className="align-top hover:bg-subtle">
              <td className="px-2 py-1.5 border-t border-line-soft">
                <div className="tabular-nums whitespace-nowrap">{formatDate2(m.date)}</div>
                <div className="text-xs text-muted truncate">{m.createdBy?.name}</div>
              </td>
              <td className="px-2 py-1.5 border-t border-line-soft min-w-0">
                <div className="flex flex-wrap items-center gap-x-2"><MovementRef m={m} /> <span className="text-xs"><MovementType m={m} /></span></div>
                {reasonText(m) && <div className="text-xs text-muted break-words">{reasonText(m)}</div>}
              </td>
              {!gudang && <td className="px-2 py-1.5 border-t border-line-soft">{m.gudang?.code}</td>}
              <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums font-medium ${m.qty > 0 ? 'text-success-fg' : 'text-danger'}`}>
                {formatSigned(m.qty)}
                {canSeeCost && m.value !== null && m.value !== undefined && (
                  <div className="text-[11px] font-normal text-muted" title={`@ ${formatRupiah(m.unitCost)}`}>{formatRupiah(m.value)}</div>
                )}
              </td>
              <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums font-semibold">
                {formatNumber(m.balanceAfter)}
                {canSeeCost && m.avgCostAfter !== null && m.avgCostAfter !== undefined && (
                  <div className="text-[11px] font-normal text-muted" title="HPP setelah pergerakan ini">HPP {formatRupiah(m.avgCostAfter)}</div>
                )}
              </td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={5} className="text-center py-6 text-muted">Belum ada pergerakan stok.</td></tr>
          )}
        </tbody>
      </table>

      {(rows.length < total || loading) && (
        <div className="py-3 text-center">
          <button
            type="button"
            onClick={() => fetchPage(page + 1)}
            disabled={loading}
            className="text-sm text-primary hover:underline cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Loading...' : `Load more (${total - rows.length})`}
          </button>
        </div>
      )}
    </SideDrawer>
  );
}
