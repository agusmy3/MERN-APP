import { useCallback } from 'react';
import {
  getUom,
  createUom,
  updateUom,
  deleteUom
} from '../services/uomService';
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
import { UOM_TYPES, uomTypeLabel } from '../utils/uomMeta';
import useToast from '../hooks/useToast';

const EMPTY_FORM = {
  code: '',
  name: '',
  type: '',
  deskripsi: ''
};

export default function Uom() {
  const { user } = useAuth();
  const toast = useToast();

  const fetchUom = useCallback(async (params) => {
    const res = await getUom(user.token, params);
    return { items: res.data.data.dataUom, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchUom);

  const crud = useCrudDrawer({
    entityName: 'UoM',
    resource: 'uom',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      code: row.code,
      name: row.name,
      type: row.type || '',
      deskripsi: row.deskripsi || ''
    }),
    prepare: (form) => {
      if (!form.type) {
        toast.warning('Please select a UoM type');
        return null;
      }
      return form;
    },
    getLabel: (row) => row.code,
    create: (payload) => createUom(payload, user.token),
    update: (id, payload) => updateUom(id, payload, user.token),
    remove: (id) => deleteUom(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    { key: 'code', header: 'Code', sortField: 'code', width: 120, className: 'font-semibold' },
    { key: 'name', header: 'Name', sortField: 'name', width: 200 },
    {
      key: 'type',
      header: 'Type',
      width: 130,
      render: (row) => (row.type ? uomTypeLabel(row.type) : <span className="text-danger text-xs" title="Isi jenis satuan supaya konversi harga vendor bisa dicek">not set</span>),
    },
    { key: 'deskripsi', header: 'Description', width: 300 },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="Unit of Measure"
      entityName="UoM"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'uom')}>
        <FormField label="Code" htmlFor="uom-code" hint="Otomatis huruf kapital, harus unik." required>
          <input
            id="uom-code"
            type="text"
            name="code"
            placeholder="e.g. PCS, KG, BOX"
            autoComplete='off'
            autoFocus
            value={form.code}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Name" htmlFor="uom-name" required>
          <input
            id="uom-name"
            type="text"
            name="name"
            placeholder="e.g. Pieces, Kilogram, Box"
            autoComplete='off'
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField
          label="Type"
          htmlFor="uom-type"
          required
          hint={form.type ? UOM_TYPES[form.type].hint : 'Menentukan konversi harga vendor yang sah: satuan beli harus sejenis dengan satuan dasar produk, kecuali Package.'}
        >
          <select id="uom-type" name="type" value={form.type} onChange={crud.handleChange} className={`${inputClass} text-fg`} required>
            <option value="">Select type</option>
            {Object.entries(UOM_TYPES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
          </select>
        </FormField>

        <FormField label="Description" htmlFor="uom-deskripsi">
          <textarea
            id="uom-deskripsi"
            name="deskripsi"
            rows={4}
            placeholder="Description"
            value={form.deskripsi}
            onChange={crud.handleChange}
            className={inputClass}
          />
        </FormField>

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
