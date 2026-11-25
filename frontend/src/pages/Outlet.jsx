import { useCallback, useEffect, useState } from 'react';
import useToast from '../hooks/useToast';
import { getOutlets, createOutlet, updateOutlet, deleteOutlet } from '../services/posService';
import { getGudangDropdown } from '../services/gudangService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import FormField from '../components/FormField';
import { AuditDetail } from '../components/AuditInfo';
import { historyAside } from '../utils/historyAside';
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { inputClass } from '../utils/formStyles';

const EMPTY_FORM = {
  code: '',
  name: '',
  gudang: '',
  phone: '',
  priceIncludesTax: true,
  receiptHeader: '',
  receiptFooter: 'Terima kasih atas kunjungan Anda',
  receiptWidth: 58,
  autoPrint: false,
  alamat: '',
  provinsi: '',
  kota: '',
  kecamatan: '',
  kodePos: '',
  latitude: '',
  longitude: '',
  deskripsi: '',
  isActive: true,
};

const hasCoord = (row) => row.latitude !== null && row.latitude !== undefined
  && row.longitude !== null && row.longitude !== undefined;

// link peta (dibuka user di tab baru; tidak ada request otomatis ke layanan luar)
const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

/**
 * Master Outlet / toko POS: lokasi + gudang sumber stok + pengaturan struk. Kasir ditugaskan ke outlet
 * di form User. Outlet yang sudah punya shift / transaksi tidak bisa dihapus -> nonaktifkan.
 */
export default function Outlet() {
  const { user } = useAuth();
  const toast = useToast();
  const [gudangs, setGudangs] = useState([]);

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangs).catch(console.error);
  }, [user.token]);

  const fetchOutlet = useCallback(async (params) => {
    const data = await getOutlets(user.token, params);
    return { items: data.dataOutlet, total: data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchOutlet);

  const crud = useCrudDrawer({
    entityName: 'Outlet',
    resource: 'outlet',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      code: row.code,
      name: row.name,
      gudang: row.gudang?._id || row.gudang || '',
      phone: row.phone || '',
      priceIncludesTax: row.priceIncludesTax !== false,
      receiptHeader: row.receiptHeader || '',
      receiptFooter: row.receiptFooter || '',
      receiptWidth: row.receiptWidth || 58,
      autoPrint: row.autoPrint === true,
      alamat: row.alamat || '',
      provinsi: row.provinsi || '',
      kota: row.kota || '',
      kecamatan: row.kecamatan || '',
      kodePos: row.kodePos || '',
      latitude: hasCoord(row) ? String(row.latitude) : '',
      longitude: hasCoord(row) ? String(row.longitude) : '',
      deskripsi: row.deskripsi || '',
      isActive: row.isActive !== false,
    }),
    getLabel: (row) => row.code,
    // validasi ringan di client (penegakan di backend)
    prepare: (form) => {
      if (!form.gudang) {
        toast.warning('Pilih gudang sumber stok.');
        return null;
      }
      if (form.kodePos && !/^\d{5}$/.test(form.kodePos)) {
        toast.warning('Kode pos harus 5 digit angka.');
        return null;
      }
      if (!form.latitude !== !form.longitude) {
        toast.warning('Isi latitude dan longitude sekaligus, atau kosongkan keduanya.');
        return null;
      }
      return form;
    },
    create: (payload) => createOutlet(payload, user.token),
    update: (id, payload) => updateOutlet(id, payload, user.token),
    remove: (id) => deleteOutlet(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    { key: 'code', header: 'Code', sortField: 'code', width: 120, className: 'font-semibold' },
    { key: 'name', header: 'Name', sortField: 'name', width: 200 },
    { key: 'gudang', header: 'Warehouse', width: 120, render: (row) => row.gudang?.code || '-' },
    { key: 'alamat', header: 'Address', width: 240 },
    { key: 'kecamatan', header: 'District', width: 150 },
    { key: 'kota', header: 'City / Regency', sortField: 'kota', width: 170 },
    { key: 'provinsi', header: 'Province', sortField: 'provinsi', width: 160 },
    { key: 'kodePos', header: 'Postal Code', width: 110 },
    {
      key: 'coord',
      header: 'Coordinates',
      width: 190,
      render: (row) => (hasCoord(row) ? (
        <a
          href={mapUrl(row.latitude, row.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          title="Buka di Google Maps"
          className="text-primary hover:underline tabular-nums text-xs"
        >
          <i className="fa fa-location-dot mr-1"></i>{row.latitude}, {row.longitude}
        </a>
      ) : ''),
    },
    {
      key: 'isActive',
      header: 'Status',
      width: 110,
      render: (row) => (row.isActive !== false
        ? <span className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-fg">Active</span>
        : <span className="text-xs px-2 py-0.5 rounded bg-subtle text-muted">Inactive</span>),
    },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="Outlet"
      entityName="Outlet"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'outlet')}>
        <FormField label="Code" htmlFor="outlet-code" hint="Otomatis huruf kapital, harus unik." required>
          <input
            id="outlet-code"
            type="text"
            name="code"
            placeholder="e.g. TOKO-01"
            autoComplete="off"
            autoFocus
            value={form.code}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Name" htmlFor="outlet-name" required>
          <input
            id="outlet-name"
            type="text"
            name="name"
            placeholder="e.g. Toko Bandung"
            autoComplete="off"
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Stock warehouse" htmlFor="outlet-gudang" hint="Stok outlet diambil dari gudang ini." required>
            <select id="outlet-gudang" name="gudang" value={form.gudang} onChange={crud.handleChange} className={`${inputClass} text-fg`} required>
              <option value="">Select warehouse</option>
              {gudangs.filter((g) => g.isActive !== false || g._id === form.gudang).map((g) => (
                <option key={g._id} value={g._id}>{g.code} — {g.name}{g.isActive === false ? ' (inactive)' : ''}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Phone" htmlFor="outlet-phone">
            <input id="outlet-phone" name="phone" type="tel" autoComplete="off" value={form.phone} onChange={crud.handleChange} className={inputClass} />
          </FormField>
        </div>

        <FormField label="Address" htmlFor="outlet-alamat">
          <textarea
            id="outlet-alamat"
            name="alamat"
            rows={2}
            placeholder="Address"
            value={form.alamat}
            onChange={crud.handleChange}
            className={inputClass}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Province" htmlFor="outlet-provinsi">
            <input id="outlet-provinsi" name="provinsi" autoComplete="off" placeholder="e.g. DKI Jakarta"
              value={form.provinsi} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="City / Regency" htmlFor="outlet-kota">
            <input id="outlet-kota" name="kota" autoComplete="off" placeholder="e.g. Jakarta Selatan"
              value={form.kota} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="District" htmlFor="outlet-kecamatan">
            <input id="outlet-kecamatan" name="kecamatan" autoComplete="off" placeholder="Kecamatan"
              value={form.kecamatan} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="Postal Code" htmlFor="outlet-kodepos" hint="5 digit.">
            <input id="outlet-kodepos" name="kodePos" autoComplete="off" inputMode="numeric" maxLength={5} placeholder="12345"
              value={form.kodePos}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, kodePos: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
              className={inputClass} />
          </FormField>
        </div>

        <FormField
          label="Coordinates"
          htmlFor="outlet-lat"
          hint={'Derajat desimal (WGS84). Bisa tempel langsung "lat, long" dari Google Maps ke kolom Latitude.'}
        >
          <div className="grid grid-cols-2 gap-4">
            <input
              id="outlet-lat"
              aria-label="Latitude"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Latitude, e.g. -6.2088"
              value={form.latitude}
              onChange={(e) => {
                const v = e.target.value;
                // "lat, long" ditempel sekaligus -> pecah ke dua kolom
                const parts = v.split(',').map((x) => x.trim());
                if (parts.length === 2 && parts.every((x) => x !== '' && !Number.isNaN(Number(x)))) {
                  crud.setForm((prev) => ({ ...prev, latitude: parts[0], longitude: parts[1] }));
                } else {
                  crud.setForm((prev) => ({ ...prev, latitude: v }));
                }
              }}
              className={inputClass}
            />
            <input
              aria-label="Longitude"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Longitude, e.g. 106.8456"
              value={form.longitude}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, longitude: e.target.value }))}
              className={inputClass}
            />
          </div>
          {form.latitude && form.longitude && !Number.isNaN(Number(form.latitude)) && !Number.isNaN(Number(form.longitude)) && (
            <a href={mapUrl(form.latitude, form.longitude)} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-1 text-xs text-primary hover:underline">
              <i className="fa fa-location-dot mr-1"></i>Lihat di Google Maps
            </a>
          )}
        </FormField>

        <fieldset className="rounded border border-line p-3 space-y-3">
          <legend className="px-1 text-sm font-semibold text-fg">POS & receipt</legend>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.priceIncludesTax}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, priceIncludesTax: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-primary" />
            <span>
              <span className="font-medium text-fg">Price includes PPN</span>
              <span className="block text-xs text-muted">Umum di retail: PPN dihitung dari dalam harga.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.autoPrint}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, autoPrint: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-primary" />
            <span>
              <span className="font-medium text-fg">Auto print receipt</span>
              <span className="block text-xs text-muted">Struk langsung dicetak setelah pembayaran.</span>
            </span>
          </label>
          <FormField label="Receipt header" htmlFor="outlet-rh" hint="Mis. nama usaha, NPWP. Nama, alamat & telepon outlet sudah otomatis tercetak.">
            <textarea id="outlet-rh" name="receiptHeader" rows={2} value={form.receiptHeader} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="Receipt footer" htmlFor="outlet-rf">
            <textarea id="outlet-rf" name="receiptFooter" rows={2} value={form.receiptFooter} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="Paper width" htmlFor="outlet-rw">
            <select id="outlet-rw" value={form.receiptWidth} onChange={(e) => crud.setForm((prev) => ({ ...prev, receiptWidth: Number(e.target.value) }))} className={`${inputClass} text-fg`}>
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </select>
          </FormField>
        </fieldset>

        <FormField label="Description" htmlFor="outlet-deskripsi">
          <textarea
            id="outlet-deskripsi"
            name="deskripsi"
            rows={3}
            placeholder="Description"
            value={form.deskripsi}
            onChange={crud.handleChange}
            className={inputClass}
          />
        </FormField>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            className="mt-0.5 w-4 h-4 accent-primary"
          />
          <span>
            <span className="font-medium text-fg">Active</span>
            <span className="block text-xs text-muted">Outlet nonaktif tidak bisa membuka shift baru.</span>
          </span>
        </label>

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
