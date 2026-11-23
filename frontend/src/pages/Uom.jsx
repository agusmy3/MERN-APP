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

const EMPTY_FORM = {
  code: '',
  name: '',
  deskripsi: ''
};

export default function Uom() {
  const { user } = useAuth();

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
      deskripsi: row.deskripsi || ''
    }),
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
