import { useCallback, useEffect, useState } from 'react';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser
} from '../services/userService';
import { getRoleDropdown } from '../services/roleService';
import { getGudangDropdown } from '../services/gudangService';
import { getOutletDropdown } from '../services/posService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import FormField from '../components/FormField';
import TruncateText from '../components/TruncateText';
import { AuditDetail } from '../components/AuditInfo';
import { historyAside } from '../utils/historyAside';

const USER_HISTORY_SCOPES = [{ key: 'changes', label: 'Changes' }, { key: 'login', label: 'Login' }];
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { inputClass } from '../utils/formStyles';

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  role: '',
  isActive: true,
  allGudang: true,
  gudangs: [],
  outlets: [],
  posPin: '',
  removePosPin: false,
};

const MIN_PASSWORD_LENGTH = 6;

export default function Users() {
  const { user, refreshUser } = useAuth();

  const fetchUsers = useCallback(async (params) => {
    const res = await getUsers(user.token, params);
    return { items: res.data.data.dataUser, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchUsers);

  // pilihan role (endpoint /dropdown: _id & name)
  const [roles, setRoles] = useState([]);
  useEffect(() => {
    getRoleDropdown(user.token)
      .then(setRoles)
      .catch((err) => console.error(err));
  }, [user.token]);

  // pilihan gudang untuk penugasan (semua gudang, termasuk nonaktif yang sudah ditugaskan)
  const [gudangs, setGudangs] = useState([]);
  const [outletList, setOutletList] = useState([]);
  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangs).catch((err) => console.error(err));
    getOutletDropdown(user.token).then(setOutletList).catch((err) => console.error(err));
  }, [user.token]);

  const isSelf = (row) => row && String(row._id) === String(user._id);

  const crud = useCrudDrawer({
    entityName: 'User',
    resource: 'user',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      name: row.name,
      email: row.email,
      password: '',
      role: row.role?._id || '',
      isActive: row.isActive !== false,
      allGudang: row.allGudang !== false,
      gudangs: (row.gudangs || []).map((g) => g._id || g),
      outlets: (row.outlets || []).map((o) => o._id || o),
      posPin: '',
      removePosPin: false,
    }),
    getLabel: (row) => row.name,
    // password kosong saat edit = tidak diubah
    prepare: (form) => {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (payload.allGudang) payload.gudangs = [];
      // PIN: kosong = tidak diubah; centang hapus = dihapus
      if (payload.removePosPin) payload.posPin = '';
      else if (!payload.posPin) delete payload.posPin;
      delete payload.removePosPin;
      return payload;
    },
    create: (payload) => createUser(payload, user.token),
    update: (id, payload) => updateUser(id, payload, user.token),
    remove: (id) => deleteUser(id, user.token),
    onSaved: () => {
      table.reload();
      refreshUser(); // jika yang diubah akun sendiri (nama/email)
    },
    onDeleted: table.reloadAfterDelete,
    // akun sendiri tidak bisa dihapus (backend juga menolak)
    canDeleteRow: (row) => !isSelf(row),
  });

  const { editingRow, form, mode } = crud;
  const editingSelf = mode !== 'create' && isSelf(editingRow);
  const toggleOutlet = (id) => crud.setForm((prev) => ({
    ...prev,
    outlets: prev.outlets.includes(id) ? prev.outlets.filter((x) => x !== id) : [...prev.outlets, id],
  }));
  const toggleGudang = (id) => crud.setForm((prev) => ({
    ...prev,
    gudangs: prev.gudangs.includes(id) ? prev.gudangs.filter((x) => x !== id) : [...prev.gudangs, id],
  }));

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortField: 'name',
      width: 200,
      render: (u) => (
        <div className="flex items-center gap-2 min-w-0">
          <TruncateText text={u.name} className="font-medium" />
          {isSelf(u) && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-subtle text-muted border border-line">YOU</span>
          )}
        </div>
      ),
    },
    { key: 'email', header: 'Email', sortField: 'email', width: 240 },
    {
      key: 'role',
      header: 'Role',
      width: 180,
      render: (u) => u.role?.name || <span className="text-danger italic">No role</span>,
    },
    {
      key: 'gudangs',
      header: 'Warehouses',
      width: 180,
      render: (u) => (u.role?.isSystem || u.allGudang !== false
        ? <span className="text-muted">All</span>
        : u.gudangs?.length
          ? <TruncateText text={u.gudangs.map((g) => g.code).join(', ')} />
          : <span className="text-danger italic">None</span>),
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (u) => (u.isActive !== false
        ? <span className="text-xs px-2 py-0.5 rounded-full bg-success-soft text-success-fg font-medium">Active</span>
        : <span className="text-xs px-2 py-0.5 rounded-full bg-subtle text-muted border border-line font-medium">Inactive</span>),
    },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="User"
      entityName="User"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'user', USER_HISTORY_SCOPES)}>
        <FormField label="Name" htmlFor="user-name" required>
          <input
            id="user-name"
            type="text"
            name="name"
            placeholder="Full name"
            autoComplete="off"
            autoFocus
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Email" htmlFor="user-email" required>
          <input
            id="user-email"
            type="email"
            name="email"
            placeholder="name@company.com"
            autoComplete="off"
            value={form.email}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        {/* password tidak pernah ditampilkan; di mode Detail field ini disembunyikan */}
        {mode !== 'view' && (
          <FormField
            label={mode === 'create' ? 'Password' : 'New Password'}
            htmlFor="user-password"
            required={mode === 'create'}
            hint={mode === 'create'
              ? `Minimal ${MIN_PASSWORD_LENGTH} karakter.`
              : 'Kosongkan jika tidak ingin mengubah password.'}
          >
            <input
              id="user-password"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={form.password}
              onChange={crud.handleChange}
              className={inputClass}
              required={mode === 'create'}
            />
          </FormField>
        )}

        <FormField
          label="Role"
          htmlFor="user-role"
          required
          hint={editingSelf ? 'Anda tidak dapat mengubah role akun sendiri.' : undefined}
        >
          <select
            id="user-role"
            name="role"
            value={form.role}
            onChange={crud.handleChange}
            disabled={editingSelf}
            className={`${inputClass} text-fg`}
            required
          >
            <option value="">Select Role</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Warehouse Access"
          htmlFor="user-all-gudang"
          hint={form.allGudang
            ? 'Semua gudang, termasuk gudang yang ditambahkan nanti. Super Admin selalu bisa mengakses semua gudang.'
            : 'Dokumen stok, PO/GR, transfer, kartu stok, nilai persediaan, reorder & dashboard hanya untuk gudang terpilih. Jumlah stok gudang lain tetap terlihat.'}
        >
          <label htmlFor="user-all-gudang" className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input
              id="user-all-gudang"
              type="checkbox"
              checked={form.allGudang}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, allGudang: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            All warehouses
          </label>
          {!form.allGudang && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded border border-line divide-y divide-line-soft">
              {gudangs.map((g) => (
                <label key={g._id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-subtle">
                  <input
                    type="checkbox"
                    checked={form.gudangs.includes(g._id)}
                    onChange={() => toggleGudang(g._id)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-mono text-xs font-semibold">{g.code}</span>
                  <span className="text-muted truncate">{g.name}</span>
                  {g.isActive === false && <span className="ml-auto text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                </label>
              ))}
              {gudangs.length === 0 && <p className="px-3 py-2 text-sm text-muted">Belum ada gudang.</p>}
            </div>
          )}
          {!form.allGudang && form.gudangs.length === 0 && (
            <p className="mt-1 text-xs text-danger">Tanpa gudang, user ini tidak bisa membuka dokumen stok apa pun.</p>
          )}
        </FormField>

        <FormField
          label="POS Outlets"
          htmlFor="user-outlets"
          hint="Outlet tempat user boleh membuka shift kasir (butuh juga izin POS Cashier di role). Super Admin bisa di semua outlet."
        >
          <div id="user-outlets" className="max-h-40 overflow-y-auto rounded border border-line divide-y divide-line-soft">
            {outletList.map((o) => (
              <label key={o._id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-subtle">
                <input type="checkbox" checked={form.outlets.includes(o._id)} onChange={() => toggleOutlet(o._id)} className="w-4 h-4 accent-primary" />
                <span className="font-mono text-xs font-semibold">{o.code}</span>
                <span className="text-muted truncate">{o.name}</span>
                {o.isActive === false && <span className="ml-auto text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
              </label>
            ))}
            {outletList.length === 0 && <p className="px-3 py-2 text-sm text-muted">Belum ada outlet.</p>}
          </div>
        </FormField>

        <FormField
          label="POS supervisor PIN"
          htmlFor="user-pos-pin"
          hint={`4-8 digit, untuk menyetujui void & retur di layar kasir (butuh izin POS Cashier: post). ${editingRow?.hasPosPin ? 'PIN sudah diatur; isi untuk mengganti.' : 'Belum ada PIN.'}`}
        >
          <div className="flex items-center gap-3">
            <input id="user-pos-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8}
              value={form.posPin} disabled={form.removePosPin}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, posPin: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
              className={`${inputClass} w-40`} placeholder={editingRow?.hasPosPin ? '••••' : ''} />
            {editingRow?.hasPosPin && (
              <label className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
                <input type="checkbox" checked={form.removePosPin} onChange={(e) => crud.setForm((prev) => ({ ...prev, removePosPin: e.target.checked, posPin: '' }))} className="w-4 h-4 accent-primary" />
                Hapus PIN
              </label>
            )}
          </div>
        </FormField>

        <FormField
          label="Status"
          htmlFor="user-active"
          hint={editingSelf
            ? 'Anda tidak dapat menonaktifkan akun sendiri.'
            : 'User nonaktif tidak bisa login, dan sesi yang sedang berjalan langsung berakhir.'}
        >
          <label htmlFor="user-active" className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input
              id="user-active"
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => crud.setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              disabled={editingSelf}
              className="w-4 h-4 accent-primary"
            />
            Active
          </label>
        </FormField>

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
