import { useCallback } from 'react';
import {
  getVariant,
  createVariant,
  updateVariant,
  deleteVariant
} from '../services/variantService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import useToast from '../hooks/useToast';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import FormField from '../components/FormField';
import TagInput from '../components/TagInput';
import { AuditDetail } from '../components/AuditInfo';
import { historyAside } from '../utils/historyAside';
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { inputClass } from '../utils/formStyles';

const EMPTY_FORM = {
  code: '',
  name: '',
  values: [],
  deskripsi: ''
};

export default function Variant() {
  const { user } = useAuth();
  const toast = useToast();

  const fetchVariant = useCallback(async (params) => {
    const res = await getVariant(user.token, params);
    return { items: res.data.data.dataVariant, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchVariant);

  const crud = useCrudDrawer({
    entityName: 'Variant',
    resource: 'variant',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      code: row.code,
      name: row.name,
      values: row.values || [],
      deskripsi: row.deskripsi || ''
    }),
    getLabel: (row) => row.code,
    prepare: (form) => {
      if (form.values.length === 0) {
        toast.warning('Please add at least one value');
        return null;
      }
      return form;
    },
    create: (payload) => createVariant(payload, user.token),
    update: (id, payload) => updateVariant(id, payload, user.token),
    remove: (id) => deleteVariant(id, user.token),
    onSaved: table.reload,
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    { key: 'code', header: 'Code', sortField: 'code', width: 120, className: 'font-semibold' },
    { key: 'name', header: 'Name', sortField: 'name', width: 180 },
    // digabung jadi satu teks agar bisa dipotong "…" dan diklik untuk melihat semua nilai
    { key: 'values', header: 'Values', width: 280, render: (v) => (v.values || []).join(', ') },
    { key: 'deskripsi', header: 'Description', width: 240 },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="Variant"
      entityName="Variant"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'variant')}>
        <FormField label="Code" htmlFor="variant-code" hint="Otomatis huruf kapital, harus unik." required>
          <input
            id="variant-code"
            type="text"
            name="code"
            placeholder="e.g. COLOR, SIZE"
            autoComplete='off'
            autoFocus
            value={form.code}
            onChange={(e) => crud.setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Name" htmlFor="variant-name" required>
          <input
            id="variant-name"
            type="text"
            name="name"
            placeholder="e.g. Warna, Ukuran"
            autoComplete='off'
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField
          label="Values"
          htmlFor="variant-values"
          hint="Tekan Enter atau koma untuk menambah. Contoh: Merah, Biru, Hitam / S, M, L, XL"
          required
        >
          <TagInput
            id="variant-values"
            value={form.values}
            onChange={(values) => crud.setForm((prev) => ({ ...prev, values }))}
            placeholder="Type a value..."
          />
        </FormField>

        <FormField label="Description" htmlFor="variant-deskripsi">
          <textarea
            id="variant-deskripsi"
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
