import { useEffect, useMemo, useState } from 'react';
import {
  generateProdukSkus,
  updateProdukSkus,
  deleteProdukSku
} from '../../services/produkService';
import useToast from '../../hooks/useToast';
import useConfirm from '../../hooks/useConfirm';
import { calcMargin, formatRupiah, variantLabel } from '../../utils/formatHelper';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;

// kunci kombinasi (sama dengan backend helpers/skuHelper.js) untuk menghitung kombinasi baru
const comboKey = (pairs) => pairs
  .map((p) => `${p.variant}:${String(p.value).trim().toLowerCase()}`)
  .sort()
  .join('|');

const EMPTY_BULK = { hargaJual: '', stok: '', isActive: '' };

const toRow = (s) => ({ _id: s._id, sku: s.sku, hargaJual: s.hargaJual, stok: s.stok, isActive: s.isActive !== false });

/**
 * Tab "Variants & SKU": generator kombinasi varian + tabel SKU yang bisa diedit langsung
 * (kode, harga jual, stok, aktif), dengan harga pokok & margin jika boleh melihat harga vendor.
 */
export default function ProdukSkuTab({ produk, skuData, canUpdate, token, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { skus, canSeeCost } = skuData;
  const baseUom = produk.uom?.code || '';

  // ---------- generator ----------
  const [selections, setSelections] = useState({});
  useEffect(() => {
    // default: semua nilai setiap jenis varian terpilih
    setSelections(Object.fromEntries((produk.variants || []).map((v) => [v._id, [...v.values]])));
  }, [produk.variants]);

  const existingKeys = useMemo(() => new Set(skus.map((s) => comboKey(
    (s.variantValues || []).map((vv) => ({ variant: vv.variant?._id || vv.variant, value: vv.value }))
  ))), [skus]);

  const { comboCount, newCount } = useMemo(() => {
    const variants = produk.variants || [];
    if (!variants.length) return { comboCount: 0, newCount: 0 };
    let combos = [[]];
    for (const v of variants) {
      const chosen = selections[v._id] || [];
      combos = combos.flatMap((c) => chosen.map((value) => [...c, { variant: v._id, value }]));
    }
    return { comboCount: combos.length, newCount: combos.filter((c) => !existingKeys.has(comboKey(c))).length };
  }, [produk.variants, selections, existingKeys]);

  const toggleValue = (variantId, value, checked) => {
    setSelections((prev) => {
      const current = prev[variantId] || [];
      return { ...prev, [variantId]: checked ? [...current, value] : current.filter((v) => v !== value) };
    });
  };

  const [generating, setGenerating] = useState(false);
  const generate = async () => {
    setGenerating(true);
    try {
      const res = await generateProdukSkus(produk._id, selections, token);
      toast.success(res.data.message);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to generate SKU');
    } finally {
      setGenerating(false);
    }
  };

  // ---------- tabel SKU yang bisa diedit ----------
  const [rows, setRows] = useState([]);
  // ---------- bulk edit: terapkan harga/stok/aktif yang sama ke SKU terpilih ----------
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState(EMPTY_BULK);

  useEffect(() => {
    setRows(skus.map(toRow));
    setSelected(new Set());
  }, [skus]);

  const toggleSelect = (id, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = (checked) => setSelected(checked ? new Set(rows.map((r) => r._id)) : new Set());

  // pilih cepat per nilai varian (mis. semua "Merah"); klik lagi untuk membatalkan
  const valueGroups = useMemo(() => {
    const groups = new Map(); // value -> { label, ids }
    for (const s of skus) {
      for (const vv of s.variantValues || []) {
        const key = `${vv.variant?._id || vv.variant}:${vv.value}`;
        if (!groups.has(key)) groups.set(key, { key, label: vv.value, variant: vv.variant?.name, ids: [] });
        groups.get(key).ids.push(s._id);
      }
    }
    return [...groups.values()];
  }, [skus]);
  const toggleGroup = (ids) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const applyBulk = () => {
    if (!selected.size) return toast.warning('Pilih minimal 1 SKU (centang di kolom kiri).');
    const changes = {};
    if (bulk.hargaJual !== '') changes.hargaJual = bulk.hargaJual;
    if (bulk.stok !== '') changes.stok = bulk.stok;
    if (bulk.isActive !== '') changes.isActive = bulk.isActive === 'true';
    if (!Object.keys(changes).length) return toast.warning('Isi harga jual, stok, atau status aktif yang ingin diterapkan.');
    if (Number(changes.hargaJual) < 0 || Number(changes.stok) < 0) return toast.warning('Harga dan stok tidak boleh negatif.');

    setRows((prev) => prev.map((r) => (selected.has(r._id) ? { ...r, ...changes } : r)));
    setBulk(EMPTY_BULK);
    toast.info(`Diterapkan ke ${selected.size} SKU. Klik "Save changes" untuk menyimpan.`);
  };
  const onBulkKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyBulk();
    }
  };

  const original = useMemo(() => new Map(skus.map((s) => [s._id, toRow(s)])), [skus]);
  const dirtyRows = rows.filter((r) => {
    const o = original.get(r._id);
    return o && (o.sku !== r.sku || Number(o.hargaJual) !== Number(r.hargaJual)
      || Number(o.stok) !== Number(r.stok) || o.isActive !== r.isActive);
  });

  const setField = (id, field, value) => {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, [field]: value } : r)));
  };

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await updateProdukSkus(produk._id, dirtyRows, token);
      toast.success(res.data.message);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save SKU');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (sku) => {
    const ok = await confirm({
      title: 'Delete SKU?',
      message: `"${sku.sku}" and all of its vendor prices will be permanently deleted.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await deleteProdukSku(produk._id, sku._id, token);
      toast.success(res.data.message);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete SKU');
    }
  };

  const skuById = new Map(skus.map((s) => [s._id, s]));
  const hasVariants = (produk.variants || []).length > 0;

  return (
    <div className="space-y-4">
      {/* Generator SKU */}
      {canUpdate && hasVariants && (
        <section className="rounded-lg border border-line bg-surface p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-fg">Generate SKU</h3>
            <p className="text-sm text-muted">
              Pilih nilai varian. Setiap kombinasi menjadi 1 SKU; kombinasi yang sudah ada dilewati.
            </p>
          </div>
          {produk.variants.map((v) => (
            <div key={v._id}>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">{v.name} ({v.code})</div>
              <div className="flex flex-wrap gap-2">
                {v.values.map((value) => {
                  const checked = (selections[v._id] || []).includes(value);
                  return (
                    <label
                      key={value}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-sm cursor-pointer
                        ${checked ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line text-fg'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleValue(v._id, value, e.target.checked)}
                        className="w-3.5 h-3.5 accent-primary"
                      />
                      {value}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-sm text-muted">
              {comboCount} kombinasi · <b className="text-fg">{newCount} SKU baru</b>
            </span>
            <button
              type="button"
              onClick={generate}
              disabled={!newCount || generating}
              className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa fa-wand-magic-sparkles"></i> {generating ? 'Generating...' : `Generate ${newCount} SKU`}
            </button>
          </div>
        </section>
      )}

      {canUpdate && !hasVariants && skus.length === 0 && (
        <section className="rounded-lg border border-line bg-surface p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Produk tanpa varian memerlukan 1 SKU default.</p>
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded cursor-pointer disabled:opacity-50"
          >
            <i className="fa fa-plus"></i> Create default SKU
          </button>
        </section>
      )}

      {/* Tabel SKU */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <div>
            <h3 className="font-semibold text-fg">SKU ({skus.length})</h3>
            <p className="text-xs text-muted">
              Harga jual & stok per {baseUom || 'satuan dasar'}.
              {canSeeCost && ' Harga pokok = harga vendor utama (atau termurah) dibagi isi per satuan beli.'}
            </p>
          </div>
          {canUpdate && (
            <div className="flex items-center gap-2">
              {dirtyRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRows(skus.map(toRow))}
                  className="px-3 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer"
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={save}
                disabled={!dirtyRows.length || saving}
                className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fa fa-save"></i> {saving ? 'Saving...' : `Save changes${dirtyRows.length ? ` (${dirtyRows.length})` : ''}`}
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: canSeeCost ? 940 : 720 }}>
            <thead className="bg-head text-head-fg text-left">
              <tr>
                {canUpdate && (
                  <th className="px-3 py-2 border-b border-line w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all SKU"
                      title="Select all"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allSelected; }}
                      onChange={(e) => toggleAll(e.target.checked)}
                      disabled={!rows.length}
                      className="w-4 h-4 accent-primary cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-3 py-2 border-b border-line font-semibold w-52">SKU Code</th>
                <th className="px-3 py-2 border-b border-line font-semibold">Variant</th>
                <th className="px-3 py-2 border-b border-line font-semibold w-36 text-right">Selling Price</th>
                <th className="px-3 py-2 border-b border-line font-semibold w-28 text-right">Stock</th>
                {canSeeCost && <th className="px-3 py-2 border-b border-line font-semibold w-36 text-right">Cost / {baseUom}</th>}
                {canSeeCost && <th className="px-3 py-2 border-b border-line font-semibold w-24 text-right">Margin</th>}
                <th className="px-3 py-2 border-b border-line font-semibold w-20 text-center">Active</th>
                {canUpdate && <th className="px-3 py-2 border-b border-line w-14"></th>}
              </tr>
            </thead>
            <tbody>
              {/* Baris bulk edit: nilai yang diisi diterapkan ke semua SKU tercentang (kosong = tidak diubah) */}
              {canUpdate && rows.length > 1 && (
                <tr className="bg-subtle">
                  <td className="px-3 py-2 border-b-2 border-line text-center text-primary">
                    <i className="fa fa-layer-group" title="Bulk edit"></i>
                  </td>
                  <td className="px-3 py-2 border-b-2 border-line">
                    <div className="font-semibold text-fg text-xs uppercase tracking-wider">Bulk edit</div>
                    <div className="text-xs text-muted">
                      {selected.size ? <><b className="text-fg">{selected.size}</b> SKU terpilih</> : 'Centang SKU di bawah'}
                    </div>
                  </td>
                  <td className="px-3 py-2 border-b-2 border-line">
                    {valueGroups.length > 0 ? (
                      <div className="flex flex-wrap gap-1" aria-label="Quick select by variant value">
                        {valueGroups.map((g) => {
                          const active = g.ids.every((id) => selected.has(id));
                          return (
                            <button
                              key={g.key}
                              type="button"
                              title={`${active ? 'Batal pilih' : 'Pilih'} semua SKU ${g.variant ? `${g.variant} ` : ''}"${g.label}" (${g.ids.length})`}
                              onClick={() => toggleGroup(g.ids)}
                              className={`text-xs px-1.5 py-0.5 rounded border cursor-pointer
                                ${active ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line text-muted hover:text-fg'}`}
                            >
                              {g.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : <span className="text-xs text-muted">Pilih SKU lewat checkbox</span>}
                  </td>
                  <td className="px-3 py-2 border-b-2 border-line">
                    <input
                      aria-label="Bulk selling price"
                      type="number"
                      min="0"
                      placeholder="Harga jual"
                      value={bulk.hargaJual}
                      onChange={(e) => setBulk((b) => ({ ...b, hargaJual: e.target.value }))}
                      onKeyDown={onBulkKeyDown}
                      className={`${cellInput} text-right tabular-nums`}
                    />
                  </td>
                  <td className="px-3 py-2 border-b-2 border-line">
                    <input
                      aria-label="Bulk stock"
                      type="number"
                      min="0"
                      placeholder="Stok"
                      value={bulk.stok}
                      onChange={(e) => setBulk((b) => ({ ...b, stok: e.target.value }))}
                      onKeyDown={onBulkKeyDown}
                      className={`${cellInput} text-right tabular-nums`}
                    />
                  </td>
                  {canSeeCost && <td className="px-3 py-2 border-b-2 border-line"></td>}
                  {canSeeCost && (
                    <td className="px-3 py-2 border-b-2 border-line text-right tabular-nums text-xs text-muted">
                      {bulk.hargaJual !== '' && selected.size > 0 && (() => {
                        // pratinjau margin untuk SKU terpilih dengan harga pokok
                        const margins = [...selected]
                          .map((id) => skuById.get(id))
                          .map((s) => calcMargin(bulk.hargaJual, s?.preferredUnitCost ?? s?.minUnitCost ?? null))
                          .filter((m) => m !== null);
                        if (!margins.length) return null;
                        const lo = Math.min(...margins);
                        const hi = Math.max(...margins);
                        return (
                          <span className={lo < 0 ? 'text-danger' : 'text-success-fg'} title="Pratinjau margin SKU terpilih">
                            {lo === hi ? `${lo.toFixed(1)}%` : `${lo.toFixed(0)}–${hi.toFixed(0)}%`}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                  <td className="px-3 py-2 border-b-2 border-line">
                    <select
                      aria-label="Bulk active status"
                      value={bulk.isActive}
                      onChange={(e) => setBulk((b) => ({ ...b, isActive: e.target.value }))}
                      className={`${cellInput} px-1`}
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 border-b-2 border-line text-center">
                    <button
                      type="button"
                      title={`Terapkan ke ${selected.size} SKU terpilih`}
                      aria-label="Apply to selected SKU"
                      onClick={applyBulk}
                      disabled={!selected.size}
                      className="w-8 h-8 rounded-md bg-primary hover:bg-primary-hover text-primary-fg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="fa fa-check text-xs"></i>
                    </button>
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const s = skuById.get(r._id);
                const cost = s?.preferredUnitCost ?? s?.minUnitCost ?? null;
                const margin = calcMargin(r.hargaJual, cost);
                const isDirty = dirtyRows.some((d) => d._id === r._id);
                const costTitle = s?.priceCount
                  ? `Termurah: ${formatRupiah(s.minUnitCost)}${s.preferredUnitCost != null ? ` · Vendor utama: ${formatRupiah(s.preferredUnitCost)}` : ''} · ${s.priceCount} harga vendor`
                  : 'Belum ada harga vendor';
                return (
                  <tr key={r._id} className={isDirty ? 'bg-highlight' : 'hover:bg-subtle'}>
                    {canUpdate && (
                      <td className="px-3 py-1.5 border-t border-line-soft text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.sku}`}
                          checked={selected.has(r._id)}
                          onChange={(e) => toggleSelect(r._id, e.target.checked)}
                          className="w-4 h-4 accent-primary cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-1.5 border-t border-line-soft">
                      <input
                        aria-label="SKU code"
                        value={r.sku}
                        disabled={!canUpdate}
                        onChange={(e) => setField(r._id, 'sku', e.target.value.toUpperCase())}
                        className={`${cellInput} font-mono text-xs`}
                      />
                    </td>
                    <td className="px-3 py-1.5 border-t border-line-soft">
                      <div className="flex flex-wrap gap-1">
                        {(s?.variantValues || []).length
                          ? s.variantValues.map((vv) => (
                            <span key={`${vv.variant?._id}-${vv.value}`} className="text-xs px-1.5 py-0.5 rounded bg-primary-soft text-primary-soft-fg" title={vv.variant?.name}>
                              {vv.value}
                            </span>
                          ))
                          : <span className="text-muted italic">{variantLabel(s)}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 border-t border-line-soft">
                      <input
                        aria-label="Selling price"
                        type="number"
                        min="0"
                        value={r.hargaJual}
                        disabled={!canUpdate}
                        onChange={(e) => setField(r._id, 'hargaJual', e.target.value)}
                        className={`${cellInput} text-right tabular-nums`}
                      />
                    </td>
                    <td className="px-3 py-1.5 border-t border-line-soft">
                      <input
                        aria-label="Stock"
                        type="number"
                        min="0"
                        value={r.stok}
                        disabled={!canUpdate}
                        onChange={(e) => setField(r._id, 'stok', e.target.value)}
                        className={`${cellInput} text-right tabular-nums`}
                      />
                    </td>
                    {canSeeCost && (
                      <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums" title={costTitle}>
                        {cost === null ? <span className="text-muted">-</span> : formatRupiah(cost)}
                      </td>
                    )}
                    {canSeeCost && (
                      <td className={`px-3 py-1.5 border-t border-line-soft text-right tabular-nums font-medium ${
                        margin === null ? 'text-muted' : margin < 0 ? 'text-danger' : 'text-success-fg'}`}
                      >
                        {margin === null ? '-' : `${margin.toFixed(1)}%`}
                      </td>
                    )}
                    <td className="px-3 py-1.5 border-t border-line-soft text-center">
                      <input
                        type="checkbox"
                        aria-label="Active"
                        checked={r.isActive}
                        disabled={!canUpdate}
                        onChange={(e) => setField(r._id, 'isActive', e.target.checked)}
                        className="w-4 h-4 accent-primary"
                      />
                    </td>
                    {canUpdate && (
                      <td className="px-3 py-1.5 border-t border-line-soft text-center">
                        <button
                          type="button"
                          title="Delete SKU"
                          aria-label="Delete SKU"
                          onClick={() => remove(s)}
                          className="w-8 h-8 rounded-md border border-danger-line text-danger hover:bg-danger-soft cursor-pointer"
                        >
                          <i className="fa fa-trash text-xs"></i>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-muted">
                    Belum ada SKU.{canUpdate && hasVariants && ' Pilih nilai varian di atas lalu klik Generate.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
