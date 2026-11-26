import { useCallback } from 'react';
import {
  getVendor,
  createVendor,
  updateVendor,
  deleteVendor
} from '../services/vendorService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import FormField from '../components/FormField';
import { AuditDetail } from '../components/AuditInfo';
import { historyAside } from '../utils/historyAside';
import VendorSuppliedProducts from '../components/produk/VendorSuppliedProducts';
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { inputClass } from '../utils/formStyles';
import RegionFields from '../components/RegionFields';
import { EMPTY_REGION, regionFrom, regionError } from '../utils/regionMeta';
import useToast from '../hooks/useToast';
import { addressLine } from '../utils/salesMeta';

const EMPTY_FORM = {
  companyName: '',
  companyAddress: '',
  ...EMPTY_REGION,
  picName: '',
  picContact: '',
  termDays: 0,
};

export default function Vendor() {
  const { user } = useAuth();
  const toast = useToast();

  const fetchVendor = useCallback(async (params) => {
    const res = await getVendor(user.token, params);
    return { items: res.data.data.dataVendor, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchVendor);

  const crud = useCrudDrawer({
    entityName: 'Vendor',
    resource: 'vendor',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      companyName: row.companyName,
      companyAddress: row.companyAddress,
      ...regionFrom(row),
      picName: row.picName,
      picContact: row.picContact,
      termDays: row.termDays ?? 0,
    }),
    getLabel: (row) => row.companyName,
    // validasi ringan di client (penegakan di backend)
    prepare: (f) => {
      const err = regionError(f);
      if (err) {
        toast.warning(err);
        return null;
      }
      return f;
    },
    create: (payload) => createVendor(payload, user.token),
    update: (id, payload) => updateVendor(id, payload, user.token),
    remove: (id) => deleteVendor(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    { key: 'companyName', header: 'Company', sortField: 'companyName', width: 220, className: 'font-medium' },
    { key: 'companyAddress', header: 'Address', width: 320, render: (row) => addressLine({ ...row, alamat: row.companyAddress }) },
    { key: 'picName', header: 'PIC', sortField: 'picName', width: 180 },
    { key: 'picContact', header: 'PIC Contact', width: 160 },
    { key: 'termDays', header: 'Term', width: 90, className: 'text-right tabular-nums', render: (row) => (row.termDays ? `${row.termDays} d` : 'Cash') },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="Vendor"
      entityName="Vendor"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'vendor')}>
        <h3 className="text-sm font-semibold text-fg border-b border-line pb-1">Company</h3>

        <FormField label="Company Name" htmlFor="vendor-company-name" required>
          <input
            id="vendor-company-name"
            type="text"
            name="companyName"
            placeholder="e.g. PT Maju Jaya"
            autoComplete='off'
            autoFocus
            value={form.companyName}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Company Address" htmlFor="vendor-company-address" required>
          <textarea
            id="vendor-company-address"
            name="companyAddress"
            rows={2}
            placeholder="Jalan, nomor, RT/RW"
            value={form.companyAddress}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <RegionFields form={form} setForm={crud.setForm} idPrefix="vendor" />

        <h3 className="text-sm font-semibold text-fg border-b border-line pb-1 pt-2">PIC (Person in Charge)</h3>

        <FormField label="PIC Name" htmlFor="vendor-pic-name" required>
          <input
            id="vendor-pic-name"
            type="text"
            name="picName"
            placeholder="Name"
            autoComplete='off'
            value={form.picName}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="PIC Contact" htmlFor="vendor-pic-contact" hint="Nomor telepon atau email." required>
          <input
            id="vendor-pic-contact"
            type="text"
            name="picContact"
            placeholder="e.g. 0812xxxxxxx"
            autoComplete='off'
            value={form.picContact}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Payment term (days)" htmlFor="vendor-term" hint="Jatuh tempo tagihan vendor = tanggal faktur + termin. 0 = tunai.">
          <input id="vendor-term" name="termDays" type="number" min="0" max="365" step="1" value={form.termDays} onChange={crud.handleChange} className={inputClass} />
        </FormField>

        {editingRow && crud.mode !== 'create' && (
          <VendorSuppliedProducts vendorId={editingRow._id} token={user.token} />
        )}

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
