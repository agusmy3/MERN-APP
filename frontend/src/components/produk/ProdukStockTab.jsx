import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getStockBalances } from '../../services/stockService';
import StockCardDrawer from './StockCardDrawer';
import { formatNumber, variantLabel } from '../../utils/formatHelper';

/**
 * Tab "Stock" detail produk (izin stockMovement:view): saldo per SKU x gudang.
 * Klik angka -> kartu stok di drawer. Drawer terikat ke URL (?tab=stock&sku=<id>[&gudang=<id>]),
 * jadi bisa dibuka dari link lain dan tombol Back menutupnya.
 * Kolom SKU (kiri) & Total (kanan) menempel saat tabel digeser (banyak gudang).
 * Stok hanya berubah lewat dokumen Stock Adjustment (tombol New Adjustment jika diizinkan).
 */
export default function ProdukStockTab({ produk, skus, token, canAdjust, refreshKey }) {
  const [balances, setBalances] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    getStockBalances(token, produk._id).then(setBalances).catch(console.error);
  }, [token, produk._id, refreshKey]);

  // kolom gudang = gudang yang pernah punya saldo untuk produk ini
  const gudangs = useMemo(() => {
    const map = new Map();
    balances.forEach((b) => b.gudang && map.set(b.gudang._id, b.gudang));
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [balances]);

  const qtyOf = useMemo(() => {
    const map = new Map(balances.map((b) => [`${b.sku}:${b.gudang?._id}`, b.qty]));
    return (skuId, gudangId) => map.get(`${skuId}:${gudangId}`) ?? 0;
  }, [balances]);

  // ---------- drawer kartu stok (state di URL) ----------
  const skuId = searchParams.get('sku');
  const gudangId = searchParams.get('gudang');

  const openCard = (nextSku, nextGudang) => {
    const params = { tab: 'stock', sku: nextSku };
    if (nextGudang) params.gudang = nextGudang;
    // dibuka dari tabel = entri history baru (Back menutup); ganti pilihan di dalam drawer = replace
    setSearchParams(params, { replace: !!skuId, state: { stockCard: true } });
  };
  const closeCard = () => {
    if (location.state?.stockCard) navigate(-1);
    else setSearchParams({ tab: 'stock' }, { replace: true });
  };

  const uom = produk.uom?.code || '';
  const totalAll = skus.reduce((sum, s) => sum + (s.stok || 0), 0);
  const currentQty = skuId
    ? (gudangId ? qtyOf(skuId, gudangId) : skus.find((s) => s._id === skuId)?.stok || 0)
    : 0;

  const cellButton = (sku, gudang, content) => {
    const active = skuId === sku._id && (gudangId || null) === (gudang?._id || null);
    return (
      <button
        type="button"
        title={`Kartu stok ${sku.sku}${gudang ? ` @ ${gudang.code}` : ' (semua gudang)'}`}
        onClick={() => openCard(sku._id, gudang?._id)}
        className={`w-full text-right tabular-nums px-2 py-1 rounded cursor-pointer
          ${active ? 'bg-primary-soft text-primary-soft-fg font-semibold' : 'hover:bg-subtle hover:text-primary'}`}
      >
        {content}
      </button>
    );
  };

  // sel menempel butuh latar sendiri supaya isi yang digeser tidak tembus
  const stickyLeft = 'sticky left-0 z-10 bg-surface';
  const stickyRight = 'sticky right-0 z-10 bg-surface';

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <div>
            <h3 className="font-semibold text-fg">Stock per warehouse</h3>
            <p className="text-xs text-muted">
              Dalam {uom || 'satuan dasar'}. Klik angka untuk membuka kartu stok. Kolom gudang = gudang yang pernah punya stok produk ini.
            </p>
          </div>
          {canAdjust && (
            <div className="flex gap-2">
              <Link to="/stock-adjustment/new?type=OPNAME" className="px-3 py-2 rounded border border-line hover:bg-subtle text-sm">
                <i className="fa fa-clipboard-check"></i> Stock Opname
              </Link>
              <Link to="/stock-adjustment/new?type=ADJUSTMENT" className="bg-primary hover:bg-primary-hover text-primary-fg px-3 py-2 rounded text-sm">
                <i className="fa fa-plus"></i> New Adjustment
              </Link>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 340 + gudangs.length * 110 }}>
            <thead className="text-left">
              <tr>
                <th className={`${stickyLeft} bg-head text-head-fg px-3 py-2 border-b border-r border-line font-semibold w-64`}>SKU</th>
                {gudangs.map((g) => (
                  <th key={g._id} className="bg-head text-head-fg px-3 py-2 border-b border-line font-semibold w-28 text-right" title={g.name}>
                    {g.code}{g.isActive === false && <span className="font-normal opacity-70"> (off)</span>}
                  </th>
                ))}
                <th className={`${stickyRight} bg-head text-head-fg px-3 py-2 border-b border-l border-line font-semibold w-28 text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s._id}>
                  <td className={`${stickyLeft} px-3 py-1 border-t border-r border-line-soft`}>
                    <div className="font-mono text-xs font-semibold">
                      {s.sku}
                      {s.isActive === false && <span className="ml-1.5 font-sans text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                    </div>
                    <div className="text-xs text-muted truncate max-w-56">{variantLabel(s)}</div>
                  </td>
                  {gudangs.map((g) => (
                    <td key={g._id} className="px-1 py-1 border-t border-line-soft">
                      {cellButton(s, g, formatNumber(qtyOf(s._id, g._id)))}
                    </td>
                  ))}
                  <td className={`${stickyRight} px-1 py-1 border-t border-l border-line-soft font-semibold`}>
                    {cellButton(s, null, formatNumber(s.stok))}
                  </td>
                </tr>
              ))}
              {skus.length === 0 && (
                <tr><td colSpan={2 + gudangs.length} className="text-center py-6 text-muted">Belum ada SKU.</td></tr>
              )}
            </tbody>
            {skus.length > 1 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className={`${stickyLeft} bg-subtle px-3 py-2 border-t border-r border-line`}>Total</td>
                  {gudangs.map((g) => (
                    <td key={g._id} className="bg-subtle px-3 py-2 border-t border-line text-right tabular-nums">
                      {formatNumber(skus.reduce((sum, s) => sum + qtyOf(s._id, g._id), 0))}
                    </td>
                  ))}
                  <td className={`${stickyRight} bg-subtle px-3 py-2 border-t border-l border-line text-right tabular-nums`}>{formatNumber(totalAll)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <StockCardDrawer
        open={!!skuId}
        token={token}
        skus={skus}
        gudangs={gudangs}
        skuId={skuId}
        gudangId={gudangId}
        currentQty={currentQty}
        uom={uom}
        refreshKey={refreshKey}
        onSelect={openCard}
        onClose={closeCard}
      />
    </div>
  );
}
