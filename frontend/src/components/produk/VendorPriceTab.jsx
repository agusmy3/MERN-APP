import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getVendorPrices,
  createVendorPrice,
  updateVendorPrice,
  deleteVendorPrice
} from '../../services/vendorPriceService';
import { getVendorDropdown } from '../../services/vendorService';
import { getUomDropdown } from '../../services/uomService';
import useCrudDrawer from '../../hooks/useCrudDrawer';
import useToast from '../../hooks/useToast';
import DataTable from '../DataTable';
import FormDrawer from '../FormDrawer';
import FormField from '../FormField';
import { AuditCell, AuditDetail } from '../AuditInfo';
import { actionColumn } from '../../utils/tableColumns';
import { inputClass } from '../../utils/formStyles';
import { formatNumber, formatRupiah, variantLabel } from '../../utils/formatHelper';

const skuText = (sku) => `${sku?.sku || '-'} (${variantLabel(sku)})`;

/**
 * Tab "Vendor Prices": harga beli SKU per vendor. Satuan beli boleh berbeda dari satuan dasar
 * produk (mis. beli per BOX isi 12, stok & jual per PCS); harga per satuan dasar dihitung otomatis.
 */
export default function VendorPriceTab({ produk, skus, token, onChanged }) {
  const toast = useToast();
  const baseUom = produk.uom?.code || '';

  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skuFilter, setSkuFilter] = useState('');
  const [vendors, setVendors] = useState([]);
  const [uoms, setUoms] = useState([]);

  const loadPrices = useCallback(async () => {
    setLoading(true);
    try {
      setPrices(await getVendorPrices(token, { produk: produk._id }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, produk._id]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  useEffect(() => {
    Promise.all([getVendorDropdown(token), getUomDropdown(token)])
      .then(([v, u]) => {
        setVendors(v);
        setUoms(u);
      })
      .catch((err) => console.error(err));
  }, [token]);

  const afterChange = () => {
    loadPrices();
    onChanged(); // harga pokok & margin di tab SKU ikut diperbarui
  };

  const crud = useCrudDrawer({
    entityName: 'Vendor Price',
    resource: 'vendorPrice',
    emptyForm: {
      vendor: '',
      skus: skuFilter ? [skuFilter] : skus.map((s) => s._id), // default: semua SKU (atau SKU yang sedang difilter)
      uomBeli: produk.uom?._id || '',
      konversi: 1,
      hargaBeli: 0,
      isPreferred: false,
      minOrder: '',
      catatan: '',
    },
    toForm: (row) => ({
      vendor: row.vendor?._id || '',
      skus: [row.sku?._id],
      uomBeli: row.uomBeli?._id || '',
      konversi: row.konversi,
      hargaBeli: row.hargaBeli,
      isPreferred: !!row.isPreferred,
      minOrder: row.minOrder ?? '',
      catatan: row.catatan || '',
    }),
    getLabel: (row) => `${row.vendor?.companyName} · ${row.sku?.sku}`,
    prepare: (form) => {
      if (!form.skus.length) {
        toast.warning('Please select at least one SKU');
        return null;
      }
      if (!(Number(form.konversi) > 0)) {
        toast.warning('Conversion must be greater than 0');
        return null;
      }
      return form;
    },
    create: (payload) => createVendorPrice(payload, token),
    // vendor & SKU tidak bisa diubah; hapus lalu tambah baru jika perlu
    update: (id, { uomBeli, konversi, hargaBeli, isPreferred, minOrder, catatan }) =>
      updateVendorPrice(id, { uomBeli, konversi, hargaBeli, isPreferred, minOrder, catatan }, token),
    remove: (id) => deleteVendorPrice(id, token),
    onSaved: afterChange,
    onDeleted: afterChange,
  });

  const { form, mode } = crud;

  // harga per satuan dasar termurah per SKU, untuk badge "Cheapest"
  const cheapest = useMemo(() => {
    const map = new Map();
    for (const p of prices) {
      const id = p.sku?._id;
      if (!map.has(id) || p.hargaPerUnit < map.get(id)) map.set(id, p.hargaPerUnit);
    }
    return map;
  }, [prices]);

  const shown = skuFilter ? prices.filter((p) => p.sku?._id === skuFilter) : prices;
  const selectedUom = uoms.find((u) => u._id === form.uomBeli);
  const unitPreview = Number(form.konversi) > 0 ? Number(form.hargaBeli || 0) / Number(form.konversi) : null;

  const columns = [
    { key: 'vendor', header: 'Vendor', width: 200, className: 'font-medium', render: (p) => p.vendor?.companyName },
    { key: 'sku', header: 'SKU', width: 220, render: (p) => skuText(p.sku) },
    {
      key: 'hargaBeli',
      header: 'Purchase Price',
      width: 170,
      className: 'text-right tabular-nums',
      render: (p) => `${formatRupiah(p.hargaBeli)} / ${p.uomBeli?.code}`,
    },
    {
      key: 'konversi',
      header: 'Conversion',
      width: 150,
      render: (p) => `1 ${p.uomBeli?.code} = ${formatNumber(p.konversi)} ${baseUom}`,
    },
    {
      key: 'hargaPerUnit',
      header: `Cost / ${baseUom}`,
      width: 190,
      className: 'text-right tabular-nums',
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          {cheapest.get(p.sku?._id) === p.hargaPerUnit && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success-fg font-semibold">CHEAPEST</span>
          )}
          <span>{formatRupiah(p.hargaPerUnit)}</span>
        </div>
      ),
    },
    {
      key: 'isPreferred',
      header: 'Preferred',
      width: 100,
      className: 'text-center',
      render: (p) => (p.isPreferred
        ? <i className="fa fa-star text-primary" title="Vendor utama untuk SKU ini" aria-label="Preferred vendor"></i>
        : <span className="text-muted">-</span>),
    },
    {
      key: 'minOrder',
      header: 'Min. Order',
      width: 110,
      className: 'text-right tabular-nums',
      render: (p) => (p.minOrder ? `${formatNumber(p.minOrder)} ${p.uomBeli?.code}` : null),
    },
    {
      key: 'audit',
      header: 'Last Modified',
      width: 220,
      render: (p) => <AuditCell row={p} />,
    },
    actionColumn(crud),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="price-sku-filter" className="text-sm text-muted shrink-0">SKU</label>
          <select
            id="price-sku-filter"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            className={`${inputClass} text-fg max-w-xs`}
          >
            <option value="">All SKUs ({skus.length})</option>
            {skus.map((s) => (
              <option key={s._id} value={s._id}>{skuText(s)}</option>
            ))}
          </select>
        </div>
        {crud.addHandler && (
          <button
            type="button"
            onClick={crud.addHandler}
            disabled={!skus.length}
            title={!skus.length ? 'Buat SKU terlebih dahulu' : undefined}
            className="shrink-0 bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa fa-plus"></i> Add Vendor Price
          </button>
        )}
      </div>

      <div className="flex flex-col max-h-[60vh]">
        <DataTable
          columns={columns}
          data={shown}
          loading={loading}
          emptyText={skus.length ? 'Belum ada harga vendor' : 'Buat SKU terlebih dahulu di tab Variants & SKU'}
          highlightKey={crud.highlightKey}
        />
      </div>

      <FormDrawer {...crud.drawerProps}>
        <FormField label="Vendor" htmlFor="price-vendor" required hint={mode === 'edit' ? 'Vendor tidak bisa diubah. Hapus lalu tambah baru jika perlu.' : undefined}>
          <select
            id="price-vendor"
            name="vendor"
            value={form.vendor}
            onChange={crud.handleChange}
            disabled={mode !== 'create'}
            className={`${inputClass} text-fg`}
            required
          >
            <option value="">Select Vendor</option>
            {vendors.map((v) => (
              <option key={v._id} value={v._id}>{v.companyName}</option>
            ))}
          </select>
        </FormField>

        {mode === 'create' ? (
          <FormField label="Apply to SKU" htmlFor="price-skus" required hint="Harga yang sama diterapkan ke semua SKU yang dipilih. Jika vendor sudah punya harga untuk SKU & satuan beli tsb, harganya diperbarui.">
            <div id="price-skus" className="rounded-md border border-line max-h-48 overflow-auto">
              <label className="flex items-center gap-2 px-3 py-2 border-b border-line-soft text-sm font-medium cursor-pointer hover:bg-subtle">
                <input
                  type="checkbox"
                  checked={form.skus.length === skus.length && skus.length > 0}
                  onChange={(e) => crud.setForm((prev) => ({ ...prev, skus: e.target.checked ? skus.map((s) => s._id) : [] }))}
                  className="w-4 h-4 accent-primary"
                />
                Select all ({form.skus.length}/{skus.length})
              </label>
              {skus.map((s) => (
                <label key={s._id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-subtle">
                  <input
                    type="checkbox"
                    checked={form.skus.includes(s._id)}
                    onChange={(e) => crud.setForm((prev) => ({
                      ...prev,
                      skus: e.target.checked ? [...prev.skus, s._id] : prev.skus.filter((id) => id !== s._id),
                    }))}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-mono text-xs">{s.sku}</span>
                  <span className="text-muted">{variantLabel(s)}</span>
                </label>
              ))}
            </div>
          </FormField>
        ) : (
          <FormField label="SKU" htmlFor="price-sku">
            <input id="price-sku" value={skuText(crud.editingRow?.sku)} disabled className={inputClass} />
          </FormField>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Purchase UoM" htmlFor="price-uom" required>
            <select
              id="price-uom"
              name="uomBeli"
              value={form.uomBeli}
              onChange={crud.handleChange}
              className={`${inputClass} text-fg`}
              required
            >
              <option value="">Select UoM</option>
              {uoms.map((u) => (
                <option key={u._id} value={u._id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Conversion" htmlFor="price-konversi" required hint={`1 ${selectedUom?.code || '?'} = ${form.konversi || '?'} ${baseUom}`}>
            <input
              id="price-konversi"
              type="number"
              name="konversi"
              min="0.01"
              step="0.01"
              value={form.konversi}
              onChange={crud.handleChange}
              className={`${inputClass} text-right`}
              required
            />
          </FormField>
        </div>

        <FormField
          label={`Purchase Price per ${selectedUom?.code || 'UoM'}`}
          htmlFor="price-harga"
          required
          hint={unitPreview !== null ? `= ${formatRupiah(unitPreview)} per ${baseUom}` : undefined}
        >
          <input
            id="price-harga"
            type="number"
            name="hargaBeli"
            min="0"
            step="0.01"
            value={form.hargaBeli}
            onChange={crud.handleChange}
            className={`${inputClass} text-right`}
            required
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label={`Min. Order (${selectedUom?.code || 'UoM'})`} htmlFor="price-minorder">
            <input
              id="price-minorder"
              type="number"
              name="minOrder"
              min="0"
              step="0.01"
              value={form.minOrder}
              onChange={crud.handleChange}
              placeholder="Optional"
              className={`${inputClass} text-right`}
            />
          </FormField>

          <FormField label="Preferred" htmlFor="price-preferred" hint="Vendor utama: dipakai sebagai harga pokok SKU.">
            <label htmlFor="price-preferred" className="inline-flex items-center gap-2 pt-2 text-sm text-fg cursor-pointer">
              <input
                id="price-preferred"
                type="checkbox"
                checked={form.isPreferred}
                onChange={(e) => crud.setForm((prev) => ({ ...prev, isPreferred: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              Preferred vendor
            </label>
          </FormField>
        </div>

        <FormField label="Notes" htmlFor="price-catatan">
          <textarea
            id="price-catatan"
            name="catatan"
            rows={2}
            value={form.catatan}
            onChange={crud.handleChange}
            placeholder="e.g. Harga berlaku untuk pembayaran tunai"
            className={inputClass}
          />
        </FormField>

        {crud.editingRow && mode !== 'create' && <AuditDetail data={crud.editingRow} />}
      </FormDrawer>
    </div>
  );
}
