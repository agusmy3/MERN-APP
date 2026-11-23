import { useCallback, useState } from 'react';
import useToast from './useToast';
import useConfirm from './useConfirm';
import usePermission from './usePermission';

const MODE_LABEL = { create: 'Add', edit: 'Edit', view: 'Detail' };

/**
 * State & aksi CRUD untuk halaman dengan form di drawer, termasuk izin (RBAC).
 *
 * options:
 *   entityName  : nama data untuk judul & pesan, mis. 'Category'
 *   resource    : key izin di backend/config/permissions.js, mis. 'kategori'
 *   emptyForm   : nilai awal form saat Add
 *   toForm(row) : ubah baris tabel menjadi nilai form saat Edit/Detail
 *   getLabel?   : (row) => teks untuk judul drawer & konfirmasi hapus, mis. row.name
 *   create(payload), update(id, payload), remove(id) : panggilan service (axios response)
 *   prepare?    : (form) => payload | null. Return null untuk membatalkan simpan (mis. validasi gagal).
 *   onSaved?(res, mode), onDeleted?() : dipanggil setelah berhasil (mis. reload tabel). `res` = response axios.
 *   canEditRow?, canDeleteRow? : (row) => boolean, batasan tambahan per baris (mis. role sistem)
 *
 * Pemakaian di halaman:
 *   <DataPage onAdd={crud.addHandler} ...>   // null jika tidak punya izin create -> tombol Add disembunyikan
 *   actionColumn(crud)                        // tombol Detail / Edit / Delete sesuai izin
 *   <FormDrawer {...crud.drawerProps}>        // mode Add / Edit / Detail (baca saja)
 */
export default function useCrudDrawer({
  entityName,
  resource,
  emptyForm,
  toForm,
  getLabel,
  create,
  update,
  remove,
  prepare,
  onSaved,
  onDeleted,
  canEditRow,
  canDeleteRow,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState('create'); // 'create' | 'edit' | 'view'
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const perm = usePermission(resource);

  const entity = entityName.toLowerCase();

  const canUpdateRow = (row) => perm.canUpdate && (canEditRow ? canEditRow(row) : true);
  const canRemoveRow = (row) => perm.canDelete && (canDeleteRow ? canDeleteRow(row) : true);

  const openCreate = () => {
    if (!perm.canCreate) return;
    setMode('create');
    setEditingRow(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  };

  const openView = (row) => {
    setMode('view');
    setEditingRow(row);
    setForm(toForm(row));
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    if (!canUpdateRow(row)) {
      openView(row);
      return;
    }
    setMode('edit');
    setEditingRow(row);
    setForm(toForm(row));
    setDrawerOpen(true);
  };

  // editingRow sengaja tidak dikosongkan agar judul drawer tidak berubah saat animasi menutup
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (mode === 'view') return;
    const payload = prepare ? prepare(form) : form;
    if (!payload) return;

    setSubmitting(true);
    try {
      const res = mode === 'edit'
        ? await update(editingRow._id, payload)
        : await create(payload);
      toast.success(res.data.message);
      setDrawerOpen(false);
      onSaved?.(res, mode);
    } catch (err) {
      // drawer tetap terbuka supaya isian tidak hilang dan bisa diperbaiki
      console.error(err);
      toast.error(err.response?.data?.message || `Failed to save ${entity}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row) => {
    const label = getLabel ? getLabel(row) : '';
    const ok = await confirm({
      title: `Delete ${entity}?`,
      message: label
        ? `"${label}" will be permanently deleted. This action cannot be undone.`
        : 'This data will be permanently deleted. This action cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await remove(row._id);
      toast.success(res.data.message);
      onDeleted?.();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || `Failed to delete ${entity}`);
    }
  };

  const rowLabel = editingRow && getLabel ? getLabel(editingRow) : '';
  const drawerTitle = `${MODE_LABEL[mode]} ${entityName}${mode !== 'create' && rowLabel ? `: ${rowLabel}` : ''}`;

  return {
    perm,
    mode,
    drawerOpen,
    editingRow,
    form,
    setForm,
    submitting,
    handleChange,
    openCreate,
    openEdit,
    openView,
    closeDrawer,
    handleSubmit,
    handleDelete,
    canUpdateRow,
    canRemoveRow,
    drawerTitle,
    // tombol Add hanya muncul jika punya izin create
    addHandler: perm.canCreate ? openCreate : null,
    // props siap pakai untuk <FormDrawer {...crud.drawerProps}>
    drawerProps: {
      open: drawerOpen,
      title: drawerTitle,
      onClose: closeDrawer,
      onSubmit: handleSubmit,
      submitting,
      readOnly: mode === 'view',
      // dari mode Detail bisa langsung pindah ke Edit jika diizinkan
      onEdit: mode === 'view' && editingRow && canUpdateRow(editingRow) ? () => setMode('edit') : undefined,
    },
    // baris yang sedang dibuka di-highlight selama drawer terbuka
    highlightKey: drawerOpen && editingRow ? editingRow._id : null,
  };
}
