import { useCallback, useEffect, useState } from 'react';
import useToast from '../hooks/useToast';
import { getOutlets, createOutlet, updateOutlet, deleteOutlet } from '../services/posService';
import { getGudangDropdown } from '../services/gudangService';
import { useSearchParams } from 'react-router-dom';
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
  gudang: '',
  phone: '',
  priceIncludesTax: true,
  receiptHeader: '',
  receiptFooter: 'Terima kasih atas kunjungan Anda',
  receiptWidth: 58,
  autoPrint: false,
  alamat: '',
  ...EMPTY_REGION,
  deskripsi: '',
  isActive: true,
};

const hasCoord = (row) => row.latitude !== null && row.latitude !== undefined
  && row.longitude !== null && row.longitude !== undefined;


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

  const [searchParams] = useSearchParams();
  const table = useDataTable(fetchOutlet, { initialSearch: searchParams.get('search') || '' });

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
      ...regionFrom(row),
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
      const regionErr = regionError(form);
      if (regionErr) {
        toast.warning(regionErr);
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

        <RegionFields form={form} setForm={crud.setForm} idPrefix="outlet" mapTitle={`Lokasi outlet ${form.name || form.code || 'baru'}`} />

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
