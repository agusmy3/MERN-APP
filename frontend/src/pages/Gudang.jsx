import { useCallback } from 'react';
import useToast from '../hooks/useToast';
import {
  getGudang,
  createGudang,
  updateGudang,
  deleteGudang
} from '../services/gudangService';
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
 * Master gudang / lokasi stok. Gudang yang sudah punya histori stok tidak bisa dihapus
 * (ditolak backend) -> nonaktifkan; gudang nonaktif tidak bisa dipilih di dokumen stok baru.
 */
export default function Gudang() {
  const { user } = useAuth();
  const toast = useToast();

  const fetchGudang = useCallback(async (params) => {
    const res = await getGudang(user.token, params);
    return { items: res.data.data.dataGudang, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchGudang);

  const crud = useCrudDrawer({
    entityName: 'Warehouse',
    resource: 'gudang',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      code: row.code,
      name: row.name,
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
    create: (payload) => createGudang(payload, user.token),
    update: (id, payload) => updateGudang(id, payload, user.token),
    remove: (id) => deleteGudang(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    { key: 'code', header: 'Code', sortField: 'code', width: 120, className: 'font-semibold' },
    { key: 'name', header: 'Name', sortField: 'name', width: 200 },
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
      fallbackTitle="Warehouse"
      entityName="Warehouse"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'gudang')}>
        <FormField label="Code" htmlFor="gudang-code" hint="Otomatis huruf kapital, harus unik." required>
          <input
            id="gudang-code"
            type="text"
            name="code"
            placeholder="e.g. MAIN, JKT-01"
            autoComplete="off"
            autoFocus
            value={form.code}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Name" htmlFor="gudang-name" required>
          <input
            id="gudang-name"
            type="text"
            name="name"
            placeholder="e.g. Main Warehouse"
            autoComplete="off"
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Address" htmlFor="gudang-alamat">
          <textarea
            id="gudang-alamat"
            name="alamat"
            rows={2}
            placeholder="Address"
            value={form.alamat}
            onChange={crud.handleChange}
            className={inputClass}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Province" htmlFor="gudang-provinsi">
            <input id="gudang-provinsi" name="provinsi" autoComplete="off" placeholder="e.g. DKI Jakarta"
              value={form.provinsi} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="City / Regency" htmlFor="gudang-kota">
            <input id="gudang-kota" name="kota" autoComplete="off" placeholder="e.g. Jakarta Selatan"
              value={form.kota} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="District" htmlFor="gudang-kecamatan">
            <input id="gudang-kecamatan" name="kecamatan" autoComplete="off" placeholder="Kecamatan"
              value={form.kecamatan} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="Postal Code" htmlFor="gudang-kodepos" hint="5 digit.">
            <input id="gudang-kodepos" name="kodePos" autoComplete="off" inputMode="numeric" maxLength={5} placeholder="12345"
              value={form.kodePos}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, kodePos: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
              className={inputClass} />
          </FormField>
        </div>

        <FormField
          label="Coordinates"
          htmlFor="gudang-lat"
          hint={'Derajat desimal (WGS84). Bisa tempel langsung "lat, long" dari Google Maps ke kolom Latitude.'}
        >
          <div className="grid grid-cols-2 gap-4">
            <input
              id="gudang-lat"
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

        <FormField label="Description" htmlFor="gudang-deskripsi">
          <textarea
            id="gudang-deskripsi"
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
            <span className="block text-xs text-muted">Gudang nonaktif tidak bisa dipilih untuk dokumen stok baru.</span>
          </span>
        </label>

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
