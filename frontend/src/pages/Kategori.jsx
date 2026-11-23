import { useCallback } from 'react';
import {
  getKategori,
  createKategori,
  updateKategori,
  deleteKategori
} from '../services/kategoriService';
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
  name: '',
  deskripsi: ''
};

export default function Kategori() {
  const { user } = useAuth();

  const fetchKategori = useCallback(async (params) => {
    const res = await getKategori(user.token, params);
    return { items: res.data.data.dataKategori, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchKategori);

  const crud = useCrudDrawer({
    entityName: 'Category',
    resource: 'kategori',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      name: row.name,
      deskripsi: row.deskripsi || ''
    }),
    getLabel: (row) => row.name,
    create: (payload) => createKategori(payload, user.token),
    update: (id, payload) => updateKategori(id, payload, user.token),
    remove: (id) => deleteKategori(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    { key: 'name', header: 'Name', sortField: 'name', width: 240, className: 'font-medium' },
    { key: 'deskripsi', header: 'Description', width: 320 },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="Category"
      entityName="Category"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'kategori')}>
        <FormField label="Name" htmlFor="kategori-name" required>
          <input
            id="kategori-name"
            type="text"
            name="name"
            placeholder="e.g. Minuman"
            autoComplete='off'
            autoFocus
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Description" htmlFor="kategori-deskripsi">
          <textarea
            id="kategori-deskripsi"
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
