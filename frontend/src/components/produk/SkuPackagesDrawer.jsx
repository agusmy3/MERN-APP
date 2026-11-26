import { useEffect, useState } from 'react';
import SideDrawer from '../SideDrawer';
import { getUomDropdown } from '../../services/uomService';
import { updateSkuPackages } from '../../services/produkService';
import useToast from '../../hooks/useToast';
import { formatRupiah, round2 } from '../../utils/formatHelper';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const toRow = (p) => ({
  key: p._id || Math.random().toString(36).slice(2),
  _id: p._id,
  uom: p.uom?._id ?? p.uom ?? '',
  konversi: p.konversi ?? '',
  hargaJual: p.hargaJual ?? '',
  barcode: p.barcode || '',
  isActive: p.isActive !== false,
});

/**
 * Kemasan jual 1 SKU (mis. PAK isi 6, DUS isi 24): satuan, isi (dalam satuan dasar), harga (kosong = isi x harga
 * satuan), barcode, aktif. Kemasan yang sudah dipakai dokumen tidak bisa dihapus (nonaktifkan). Izin produk:update.
 */
export default function SkuPackagesDrawer({ open, sku, produk, canUpdate, token, onClose, onSaved }) {
  const toast = useToast();
  const [uoms, setUoms] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const baseUom = produk.uom;

  useEffect(() => {
    if (open) getUomDropdown(token).then(setUoms).catch(console.error);
  }, [open, token]);
  useEffect(() => {
    if (open && sku) setRows((sku.packages || []).map(toRow));
  }, [open, sku]);

  const set = (key, field, value) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const add = () => setRows((prev) => [...prev, toRow({})]);
  const remove = (key) => setRows((prev) => prev.filter((r) => r.key !== key));

  const save = async () => {
    const bad = rows.find((r) => !r.uom || !(Number(r.konversi) > 1));
    if (bad) return toast.warning('Isi satuan dan isi (> 1) untuk setiap kemasan.');
    setBusy(true);
    try {
      const res = await updateSkuPackages(produk._id, sku._id, rows.map((r) => ({
        _id: r._id, uom: r.uom, konversi: Number(r.konversi), hargaJual: r.hargaJual === '' ? null : Number(r.hargaJual),
        barcode: r.barcode || null, isActive: r.isActive,
      })), token);
      toast.success(res.data.message);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save packages');
    } finally {
      setBusy(false);
    }
  };

  const used = new Set(rows.map((r) => String(r.uom)));
  return (
    <SideDrawer open={open} onClose={onClose} widthClass="sm:max-w-3xl"
      title={`Selling packages · ${sku?.sku || ''}`}
      subtitle={`Satuan dasar ${baseUom?.code || ''} @ ${formatRupiah(sku?.hargaJual)}. Harga kosong = isi x harga satuan dasar.`}>
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 640 }}>
            <thead className="bg-head text-head-fg text-left">
              <tr>
                <th className="px-2 py-2 border-b border-line font-semibold">Unit</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right">Content ({baseUom?.code})</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-36 text-right">Price</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-40">Barcode</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-16 text-center">Active</th>
                {canUpdate && <th className="px-2 py-2 border-b border-line w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const def = Number(r.konversi) > 1 ? round2((sku?.hargaJual || 0) * Number(r.konversi)) : null;
                return (
                  <tr key={r.key} className="hover:bg-subtle">
                    <td className="px-2 py-1.5 border-t border-line-soft">
                      <select aria-label="Package unit" value={r.uom} disabled={!canUpdate || busy} onChange={(e) => set(r.key, 'uom', e.target.value)} className={cellInput}>
                        <option value="">— choose —</option>
                        {uoms.filter((u) => String(u._id) !== String(baseUom?._id) && (!used.has(String(u._id)) || String(u._id) === String(r.uom)))
                          .map((u) => <option key={u._id} value={u._id}>{u.code} — {u.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 border-t border-line-soft">
                      <input aria-label="Content" type="number" min="1.01" step="0.01" value={r.konversi} disabled={!canUpdate || busy}
                        onChange={(e) => set(r.key, 'konversi', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                    </td>
                    <td className="px-2 py-1.5 border-t border-line-soft">
                      <input aria-label="Package price" type="number" min="0" step="0.01" value={r.hargaJual} disabled={!canUpdate || busy}
                        placeholder={def !== null ? String(def) : ''} onChange={(e) => set(r.key, 'hargaJual', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                      {r.hargaJual !== '' && def !== null && Number(r.hargaJual) < def && (
                        <div className="text-[10px] text-muted text-right">hemat {formatRupiah(def - Number(r.hargaJual))}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 border-t border-line-soft">
                      <input aria-label="Package barcode" value={r.barcode} maxLength={64} disabled={!canUpdate || busy} placeholder={canUpdate ? 'Scan' : ''}
                        onChange={(e) => set(r.key, 'barcode', e.target.value.replace(/\s/g, ''))} className={`${cellInput} font-mono text-xs`} />
                    </td>
                    <td className="px-2 py-1.5 border-t border-line-soft text-center">
                      <input type="checkbox" aria-label="Package active" checked={r.isActive} disabled={!canUpdate || busy}
                        onChange={(e) => set(r.key, 'isActive', e.target.checked)} className="w-4 h-4 accent-primary" />
                    </td>
                    {canUpdate && (
                      <td className="px-2 py-1.5 border-t border-line-soft text-center">
                        <button type="button" title="Remove package" aria-label="Remove package" onClick={() => remove(r.key)} disabled={busy}
                          className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer">
                          <i className="fa fa-xmark"></i>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="text-center py-6 text-muted">Belum ada kemasan jual: hanya dijual per {baseUom?.code}.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Jenis satuan harus cocok (mis. DUS / PAK / BOX untuk barang hitungan). Kemasan yang sudah dipakai di dokumen penjualan atau price list
          tidak bisa dihapus; nonaktifkan agar tidak bisa dipilih lagi.
        </p>
        {canUpdate && (
          <div className="flex justify-between gap-2">
            <button type="button" onClick={add} disabled={busy} className={`${btn} border border-line hover:bg-subtle`}><i className="fa fa-plus"></i> Add package</button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={`${btn} border border-line hover:bg-subtle`}>Cancel</button>
              <button type="button" onClick={save} disabled={busy} className={`${btn} bg-primary hover:bg-primary-hover text-primary-fg`}><i className="fa fa-save"></i> Save packages</button>
            </div>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
