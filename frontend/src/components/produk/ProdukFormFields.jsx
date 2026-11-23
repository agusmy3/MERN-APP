import FormField from '../FormField';
import { inputClass } from '../../utils/formStyles';

/**
 * Field form info produk (dipakai di drawer halaman daftar & halaman detail).
 * `variantsLocked` = produk sudah punya SKU, jenis varian tidak bisa diubah (backend juga menolak).
 */
export default function ProdukFormFields({ form, setForm, onChange, options, variantsLocked = false }) {
  const toggleVariant = (id, checked) => {
    setForm((prev) => ({
      ...prev,
      variants: checked ? [...prev.variants, id] : prev.variants.filter((v) => v !== id),
    }));
  };

  return (
    <>
      <FormField label="Name" htmlFor="produk-name" required>
        <input
          id="produk-name"
          type="text"
          name="name"
          placeholder="e.g. Kaos Polos"
          autoComplete="off"
          autoFocus
          value={form.name}
          onChange={onChange}
          className={inputClass}
          required
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Category" htmlFor="produk-kategori" required>
          <select
            id="produk-kategori"
            name="kategori"
            value={form.kategori}
            onChange={onChange}
            className={`${inputClass} text-fg`}
            required
          >
            <option value="">Select Category</option>
            {options.kategori.map((k) => (
              <option key={k._id} value={k._id}>{k.name}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Base UoM" htmlFor="produk-uom" required hint="Satuan stok & jual">
          <select
            id="produk-uom"
            name="uom"
            value={form.uom}
            onChange={onChange}
            className={`${inputClass} text-fg`}
            required
          >
            <option value="">Select UoM</option>
            {options.uom.map((u) => (
              <option key={u._id} value={u._id}>{u.code} — {u.name}</option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField
        label="Variant Types"
        htmlFor="produk-variants"
        hint={variantsLocked
          ? 'Produk sudah punya SKU. Hapus semua SKU terlebih dahulu untuk mengubah jenis varian.'
          : 'Kosongkan jika produk tidak punya varian (otomatis dibuatkan 1 SKU default).'}
      >
        <div id="produk-variants" className="flex flex-wrap gap-2 pt-1">
          {options.variants.length === 0 && <span className="text-sm text-muted">Belum ada data Variant.</span>}
          {options.variants.map((v) => {
            const checked = form.variants.includes(v._id);
            return (
              <label
                key={v._id}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm cursor-pointer
                  ${checked ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line text-fg'}
                  ${variantsLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={variantsLocked}
                  onChange={(e) => toggleVariant(v._id, e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="font-semibold">{v.code}</span>
                <span className="text-muted">{v.name}</span>
              </label>
            );
          })}
        </div>
      </FormField>

      <FormField label="Description" htmlFor="produk-deskripsi">
        <textarea
          id="produk-deskripsi"
          name="deskripsi"
          rows={3}
          placeholder="Description"
          value={form.deskripsi}
          onChange={onChange}
          className={inputClass}
        />
      </FormField>
    </>
  );
}
