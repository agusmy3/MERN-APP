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
import RegionFields from '../components/RegionFields';
import { EMPTY_REGION, regionFrom, regionError, mapUrl } from '../utils/regionMeta';

const EMPTY_FORM = {
  code: '',
  name: '',
  alamat: '',
  ...EMPTY_REGION,
  deskripsi: '',
  isActive: true,
};

const hasCoord = (row) => row.latitude !== null && row.latitude !== undefined
  && row.longitude !== null && row.longitude !== undefined;


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
      ...regionFrom(row),
      deskripsi: row.deskripsi || '',
      isActive: row.isActive !== false,
    }),
    getLabel: (row) => row.code,
    // validasi ringan di client (penegakan di backend)
    prepare: (form) => {
      const regionErr = regionError(form);
      if (regionErr) {
        toast.warning(regionErr);
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
    { key: 'kelurahan', header: 'Village', width: 150 },
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

        <RegionFields form={form} setForm={crud.setForm} idPrefix="gudang" />

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
