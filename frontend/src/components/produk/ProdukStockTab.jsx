import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getStockBalances, getReorderRules, saveReorderRules } from '../../services/stockService';
import { getGudangDropdown } from '../../services/gudangService';
import useToast from '../../hooks/useToast';
import StockCardDrawer from './StockCardDrawer';
import { formatNumber, variantLabel } from '../../utils/formatHelper';

/**
 * Tab "Stock" detail produk (izin stockMovement:view): saldo per SKU x gudang.
 * Klik angka -> kartu stok di drawer. Drawer terikat ke URL (?tab=stock&sku=<id>[&gudang=<id>]),
 * jadi bisa dibuka dari link lain dan tombol Back menutupnya.
 * Kolom SKU (kiri) & Total (kanan) menempel saat tabel digeser (banyak gudang).
 * Stok hanya berubah lewat dokumen Stock Adjustment (tombol New Adjustment jika diizinkan).
 * Reorder (izin reorder): tiap sel menampilkan min/max; mode "Edit reorder levels" (reorder:update)
 * mengisi min & max per SKU x gudang (kosongkan keduanya = hapus).
 * Gudang di luar penugasan user: jumlah stok tetap terlihat, tetapi kartu stok & reorder-nya terkunci.
 */
export default function ProdukStockTab({ produk, skus, token, canAdjust, refreshKey, canViewReorder, canEditReorder }) {
  const toast = useToast();
  const [balances, setBalances] = useState([]);
  const [rules, setRules] = useState([]);
  const [allGudangs, setAllGudangs] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({}); // "sku:gudang" -> { minQty, maxQty }
  const [saving, setSaving] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    getStockBalances(token, produk._id).then(setBalances).catch(console.error);
  }, [token, produk._id, refreshKey]);

  const loadRules = useCallback(() => {
    if (!canViewReorder) return;
    getReorderRules(token, produk._id).then(setRules).catch(console.error);
  }, [token, produk._id, canViewReorder]);
  useEffect(() => { loadRules(); }, [loadRules, refreshKey]);

  useEffect(() => {
    if (canEditReorder) getGudangDropdown(token).then((list) => setAllGudangs(list.filter((g) => g.isActive !== false))).catch(console.error);
  }, [token, canEditReorder]);

  const ruleOf = useMemo(() => {
    const map = new Map(rules.map((r) => [`${r.sku}:${r.gudang}`, r]));
    return (skuId, gudangId) => map.get(`${skuId}:${gudangId}`) || null;
  }, [rules]);

  // kolom gudang = gudang yang pernah punya saldo / rule untuk produk ini (+ semua gudang aktif saat edit)
  const gudangs = useMemo(() => {
    const map = new Map();
    balances.forEach((b) => b.gudang && map.set(b.gudang._id, b.gudang));
    const known = new Map(allGudangs.map((g) => [g._id, g]));
    rules.forEach((r) => { if (!map.has(String(r.gudang)) && known.has(String(r.gudang))) map.set(String(r.gudang), known.get(String(r.gudang))); });
    if (editing) allGudangs.forEach((g) => { if (!map.has(g._id) && g.accessible !== false) map.set(g._id, g); });
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [balances, rules, allGudangs, editing]);

  // gudang yang boleh diakses user (dari saldo / dropdown); tidak diketahui = boleh (backend tetap memeriksa)
  const lockedGudang = useMemo(() => {
    const locked = new Set();
    balances.forEach((b) => { if (b.gudang && b.accessible === false) locked.add(b.gudang._id); });
    allGudangs.forEach((g) => { if (g.accessible === false) locked.add(g._id); });
    return locked;
  }, [balances, allGudangs]);
  const cardGudangs = useMemo(() => gudangs.filter((g) => !lockedGudang.has(g._id)), [gudangs, lockedGudang]);

  // ---------- edit min / max ----------
  const startEdit = () => {
    setDraft(Object.fromEntries(rules.map((r) => [`${r.sku}:${r.gudang}`, { minQty: r.minQty, maxQty: r.maxQty }])));
    setEditing(true);
  };
  const setCell = (key, field, value) => setDraft((d) => ({ ...d, [key]: { ...(d[key] || { minQty: '', maxQty: '' }), [field]: value } }));
  const saveRules = async () => {
    const changed = [];
    for (const s of skus) {
      for (const g of gudangs) {
        const key = `${s._id}:${g._id}`;
        if (lockedGudang.has(g._id)) continue;
        const cur = ruleOf(s._id, g._id);
        const d = draft[key] || { minQty: '', maxQty: '' };
        const same = cur ? String(cur.minQty) === String(d.minQty) && String(cur.maxQty) === String(d.maxQty)
          : d.minQty === '' && d.maxQty === '';
        if (!same) changed.push({ sku: s._id, gudang: g._id, minQty: d.minQty, maxQty: d.maxQty });
      }
    }
    if (!changed.length) {
      setEditing(false);
      return;
    }
    const incomplete = changed.find((c) => (c.minQty === '') !== (c.maxQty === ''));
    if (incomplete) return toast.warning('Isi min dan max sekaligus (atau kosongkan keduanya untuk menghapus).');
    setSaving(true);
    try {
      const res = await saveReorderRules(changed, token);
      toast.success(res.data.message);
      setEditing(false);
      loadRules();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save reorder levels');
    } finally {
      setSaving(false);
    }
  };

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
    if (gudang && lockedGudang.has(gudang._id)) {
      return (
        <div className="w-full text-right tabular-nums px-2 py-1 text-muted" title={`Anda tidak ditugaskan di gudang ${gudang.code}: hanya jumlah stok yang terlihat`}>
          {content}
        </div>
      );
    }
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
              {canViewReorder && ' Angka kecil = batas reorder min / max.'}
            </p>
          </div>
          {editing ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="px-3 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer">Cancel</button>
              <button type="button" onClick={saveRules} disabled={saving}
                className="bg-primary hover:bg-primary-hover text-primary-fg px-3 py-2 rounded text-sm cursor-pointer disabled:opacity-50">
                <i className="fa fa-save"></i> {saving ? 'Saving...' : 'Save reorder levels'}
              </button>
            </div>
          ) : (canAdjust || canEditReorder) && (
            <div className="flex gap-2">
              {canEditReorder && (
                <button type="button" onClick={startEdit} className="px-3 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer">
                  <i className="fa fa-bell"></i> Edit reorder levels
                </button>
              )}
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
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 340 + gudangs.length * (editing ? 170 : 110) }}>
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
                  {gudangs.map((g) => {
                    const key = `${s._id}:${g._id}`;
                    const qty = qtyOf(s._id, g._id);
                    const rule = ruleOf(s._id, g._id);
                    if (editing && lockedGudang.has(g._id)) {
                      return (
                        <td key={g._id} className="px-1 py-1 border-t border-line-soft text-right text-xs text-muted" title="Tidak ditugaskan di gudang ini">
                          <i className="fa fa-lock mr-1"></i>{formatNumber(qty)}
                        </td>
                      );
                    }
                    if (editing) {
                      const d = draft[key] || { minQty: '', maxQty: '' };
                      return (
                        <td key={g._id} className="px-1 py-1 border-t border-line-soft">
                          <div className="flex items-center gap-1">
                            <input aria-label={`Min ${s.sku} ${g.code}`} type="number" min="0" step="0.01" placeholder="min" value={d.minQty}
                              onChange={(e) => setCell(key, 'minQty', e.target.value)}
                              className="w-full bg-input text-fg border border-line rounded px-1.5 py-1 text-xs text-right tabular-nums focus:outline-none focus:border-primary" />
                            <input aria-label={`Max ${s.sku} ${g.code}`} type="number" min="0" step="0.01" placeholder="max" value={d.maxQty}
                              onChange={(e) => setCell(key, 'maxQty', e.target.value)}
                              className="w-full bg-input text-fg border border-line rounded px-1.5 py-1 text-xs text-right tabular-nums focus:outline-none focus:border-primary" />
                          </div>
                          <div className="text-[10px] text-muted text-right mt-0.5">stok {formatNumber(qty)}</div>
                        </td>
                      );
                    }
                    const low = rule && qty <= rule.minQty;
                    return (
                      <td key={g._id} className="px-1 py-1 border-t border-line-soft">
                        {cellButton(s, g, formatNumber(qty))}
                        {canViewReorder && rule && (
                          <div className={`text-[10px] text-right px-2 ${low ? 'text-danger font-semibold' : 'text-muted'}`}
                            title={low ? 'Stok di bawah / sama dengan minimum' : 'Batas reorder'}>
                            {low && <i className="fa fa-triangle-exclamation mr-0.5"></i>}{formatNumber(rule.minQty)} / {formatNumber(rule.maxQty)}
                          </div>
                        )}
                      </td>
                    );
                  })}
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
        gudangs={cardGudangs}
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
