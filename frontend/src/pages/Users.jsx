import { useCallback, useEffect, useState } from 'react';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser
} from '../services/userService';
import { getRoleDropdown } from '../services/roleService';
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
  isActive: true
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
      isActive: row.isActive !== false
    }),
    getLabel: (row) => row.name,
    // password kosong saat edit = tidak diubah
    prepare: (form) => {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
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
