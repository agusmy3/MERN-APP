import { useCallback, useEffect, useState } from 'react';
import { getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, getPriceListDropdown } from '../services/salesService';
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
import { EMPTY_REGION, regionFrom, regionError } from '../utils/regionMeta';
import useToast from '../hooks/useToast';
import { addressLine } from '../utils/salesMeta';
import usePermission from '../hooks/usePermission';
import CreditSummary from '../components/sales/CreditSummary';
import { formatNumber } from '../utils/formatHelper';

const EMPTY_FORM = {
  code: '',
  name: '',
  phone: '',
  email: '',
  address: '',
  ...EMPTY_REGION,
  npwp: '',
  deskripsi: '',
  termDays: 0,
  creditLimit: 0,
  priceList: '',
  isActive: true,
};

/** Master Customer. Customer "Umum / Walk-in" bawaan tidak bisa dihapus / dinonaktifkan. */
export default function Customer() {
  const { user } = useAuth();
  const toast = useToast();
  const [priceLists, setPriceLists] = useState([]);
  useEffect(() => {
    getPriceListDropdown(user.token).then(setPriceLists).catch(console.error);
  }, [user.token]);

  const fetchCustomers = useCallback(async (params) => {
    const data = await getCustomers(user.token, params);
    return { items: data.dataCustomer, total: data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchCustomers);

  const crud = useCrudDrawer({
    entityName: 'Customer',
    resource: 'customer',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      code: row.code,
      name: row.name,
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      ...regionFrom(row),
      npwp: row.npwp || '',
      deskripsi: row.deskripsi || '',
      termDays: row.termDays ?? 0,
      creditLimit: row.creditLimit ?? 0,
      priceList: row.priceList?._id || '',
      isActive: row.isActive !== false,
    }),
    getLabel: (row) => row.name,
    // validasi ringan di client (penegakan di backend)
    prepare: (f) => {
      const err = regionError(f);
      if (err) {
        toast.warning(err);
        return null;
      }
      return f;
    },
    canDeleteRow: (row) => !row.isWalkIn,
    create: (payload) => createCustomer(payload, user.token),
    update: (id, payload) => updateCustomer(id, payload, user.token),
    remove: (id) => deleteCustomer(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;
  const isWalkIn = !!editingRow?.isWalkIn;
  // batas kredit hanya bisa diubah user yang boleh menyetujui SO melewati batas
  const { canApprove } = usePermission('salesOrder');
  const [credit, setCredit] = useState(null);
  const editingId = editingRow && !editingRow.isWalkIn ? editingRow._id : null;
  useEffect(() => {
    setCredit(null);
    if (!editingId) return;
    getCustomer(editingId, user.token).then((c) => setCredit(c.credit || null)).catch(() => setCredit(null));
  }, [editingId, user.token]);

  const columns = [
    { key: 'code', header: 'Code', sortField: 'code', width: 130, className: 'font-semibold font-mono text-sm' },
    {
      key: 'name',
      header: 'Name',
      sortField: 'name',
      width: 220,
      render: (row) => (
        <span>
          {row.name}
          {row.isWalkIn && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary-soft-fg">default</span>}
        </span>
      ),
    },
    { key: 'phone', header: 'Phone', sortField: 'phone', width: 140 },
    { key: 'email', header: 'Email', width: 200 },
    { key: 'priceList', header: 'Price List', width: 140, render: (row) => row.priceList?.name || <span className="text-muted">Default</span> },
    { key: 'termDays', header: 'Term', width: 90, className: 'text-right tabular-nums', render: (row) => (row.termDays ? `${row.termDays} d` : 'Cash') },
    {
      key: 'creditLimit',
      header: 'Credit Limit',
      width: 130,
      className: 'text-right tabular-nums',
      render: (row) => (row.creditLimit ? formatNumber(row.creditLimit) : <span className="text-muted">–</span>),
    },
    { key: 'address', header: 'Address', width: 320, render: (row) => addressLine(row) },
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
      fallbackTitle="Customer"
      entityName="Customer"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'customer')}>
        <FormField label="Code" htmlFor="cust-code" hint="Kosongkan untuk kode otomatis (CUST00001). Huruf kapital, harus unik.">
          <input
            id="cust-code"
            name="code"
            autoComplete="off"
            placeholder="Auto"
            value={form.code}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className={inputClass}
          />
        </FormField>

        <FormField label="Name" htmlFor="cust-name" required>
          <input id="cust-name" name="name" autoComplete="off" autoFocus value={form.name} onChange={crud.handleChange} className={inputClass} required />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Phone" htmlFor="cust-phone">
            <input id="cust-phone" name="phone" type="tel" autoComplete="off" value={form.phone} onChange={crud.handleChange} className={inputClass} />
          </FormField>
          <FormField label="Email" htmlFor="cust-email">
            <input id="cust-email" name="email" type="email" autoComplete="off" value={form.email} onChange={crud.handleChange} className={inputClass} />
          </FormField>
        </div>

        <FormField label="Address" htmlFor="cust-address">
          <textarea id="cust-address" name="address" rows={2} placeholder="Jalan, nomor, RT/RW" value={form.address} onChange={crud.handleChange} className={inputClass} />
        </FormField>

        <RegionFields form={form} setForm={crud.setForm} idPrefix="cust" />

        <FormField label="Payment term (days)" htmlFor="cust-term" hint="Jatuh tempo invoice = tanggal invoice + termin. 0 = tunai.">
          <input id="cust-term" name="termDays" type="number" min="0" max="365" step="1" value={form.termDays} onChange={crud.handleChange} className={inputClass} />
        </FormField>

        {!isWalkIn && (
          <FormField label="Credit limit" htmlFor="cust-credit"
            hint={canApprove
              ? 'Batas piutang + SO belum ditagih. Konfirmasi SO yang melewatinya butuh persetujuan. 0 = tanpa batas.'
              : 'Hanya bisa diubah user dengan izin Sales Order: Approve. 0 = tanpa batas.'}>
            <input id="cust-credit" name="creditLimit" type="number" min="0" step="0.01" value={form.creditLimit}
              onChange={crud.handleChange} disabled={!canApprove} className={inputClass} />
          </FormField>
        )}
        {credit && <CreditSummary credit={credit} />}

        <FormField label="Price list" htmlFor="cust-pl" hint="Kosong = harga jual default SKU.">
          <select id="cust-pl" name="priceList" value={form.priceList} onChange={crud.handleChange} className={`${inputClass} text-fg`}>
            <option value="">Default price</option>
            {priceLists.filter((p) => p.isActive !== false || p._id === form.priceList).map((p) => (
              <option key={p._id} value={p._id}>{p.name} ({p.code}){p.isActive === false ? ' – inactive' : ''}</option>
            ))}
          </select>
        </FormField>

        <FormField label="NPWP" htmlFor="cust-npwp" hint="Opsional, untuk faktur pajak.">
          <input id="cust-npwp" name="npwp" autoComplete="off" value={form.npwp} onChange={crud.handleChange} className={inputClass} />
        </FormField>

        <FormField label="Note" htmlFor="cust-deskripsi">
          <textarea id="cust-deskripsi" name="deskripsi" rows={3} value={form.deskripsi} onChange={crud.handleChange} className={inputClass} />
        </FormField>

        <label className={`flex items-start gap-2 text-sm ${isWalkIn ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={form.isActive}
            disabled={isWalkIn}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            className="mt-0.5 w-4 h-4 accent-primary"
          />
          <span>
            <span className="font-medium text-fg">Active</span>
            <span className="block text-xs text-muted">
              {isWalkIn ? 'Customer bawaan untuk penjualan tanpa data pembeli: selalu aktif.' : 'Customer nonaktif tidak bisa dipilih untuk penjualan baru.'}
            </span>
          </span>
        </label>

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
