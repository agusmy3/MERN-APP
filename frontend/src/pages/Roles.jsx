import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getRoles,
  getRoleResources,
  createRole,
  updateRole,
  deleteRole
} from '../services/roleService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import FormField from '../components/FormField';
import PermissionMatrix from '../components/PermissionMatrix';
import TruncateText from '../components/TruncateText';
import { AuditDetail } from '../components/AuditInfo';
import { historyAside } from '../utils/historyAside';
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { inputClass } from '../utils/formStyles';

const EMPTY_FORM = {
  name: '',
  deskripsi: '',
  permissions: {} // { produk: ['view', 'create'], ... }
};

export default function Roles() {
  const { user, refreshUser } = useAuth();

  const fetchRoles = useCallback(async (params) => {
    const res = await getRoles(user.token, params);
    return { items: res.data.data.dataRole, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchRoles);

  // registri resource & action dari backend (sumber yang sama dengan pengecekan izin)
  const [registry, setRegistry] = useState({ resources: [], actions: [] });
  useEffect(() => {
    getRoleResources(user.token)
      .then(setRegistry)
      .catch((err) => console.error(err));
  }, [user.token]);

  const resourceLabel = useMemo(
    () => new Map(registry.resources.map((r) => [r.key, r.label])),
    [registry.resources]
  );

  const crud = useCrudDrawer({
    entityName: 'Role',
    resource: 'role',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      name: row.name,
      deskripsi: row.deskripsi || '',
      permissions: Object.fromEntries((row.permissions || []).map((p) => [p.resource, p.actions])),
    }),
    getLabel: (row) => row.name,
    prepare: (form) => ({
      name: form.name,
      deskripsi: form.deskripsi,
      permissions: Object.entries(form.permissions)
        .filter(([, actions]) => actions.length)
        .map(([resource, actions]) => ({ resource, actions })),
    }),
    create: (payload) => createRole(payload, user.token),
    update: (id, payload) => updateRole(id, payload, user.token),
    remove: (id) => deleteRole(id, user.token),
    onSaved: () => {
      table.reload();
      refreshUser(); // izin role milik user sendiri mungkin ikut berubah
    },
    onDeleted: table.reloadAfterDelete,
    // role sistem (Super Admin) tidak bisa diubah/dihapus
    canEditRow: (row) => !row.isSystem,
    canDeleteRow: (row) => !row.isSystem,
  });

  const { editingRow, form } = crud;

  const accessSummary = (row) => {
    if (row.isSystem) return 'Full access';
    const labels = (row.permissions || []).map((p) => {
      const ops = p.actions.filter((a) => a !== 'view').map((a) => a[0].toUpperCase()).join('');
      return `${resourceLabel.get(p.resource) || p.resource}${ops ? ` (${ops})` : ''}`;
    });
    return labels.join(', ') || 'No access';
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortField: 'name',
      width: 200,
      render: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <TruncateText text={r.name} className="font-medium" />
          {r.isSystem && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary-soft-fg font-semibold">SYSTEM</span>
          )}
        </div>
      ),
    },
    { key: 'deskripsi', header: 'Description', width: 220 },
    {
      key: 'access',
      header: 'Access',
      width: 280,
      // V = view saja; huruf di kurung = operasi tambahan: C(reate) U(pdate) D(elete)
      render: (r) => accessSummary(r),
    },
    { key: 'userCount', header: 'Users', width: 80, className: 'text-right tabular-nums' },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  const isSystemRole = !!editingRow?.isSystem && crud.mode !== 'create';

  return (
    <DataPage
      fallbackTitle="Role"
      entityName="Role"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer
        {...crud.drawerProps}
        wide
        aside={historyAside(crud, 'role')}
      >
        <FormField label="Name" htmlFor="role-name" required>
          <input
            id="role-name"
            type="text"
            name="name"
            placeholder="e.g. Staff Gudang"
            autoComplete="off"
            autoFocus
            value={form.name}
            onChange={crud.handleChange}
            className={inputClass}
            required
          />
        </FormField>

        <FormField label="Description" htmlFor="role-deskripsi">
          <textarea
            id="role-deskripsi"
            name="deskripsi"
            rows={2}
            placeholder="Tugas atau tanggung jawab role ini"
            value={form.deskripsi}
            onChange={crud.handleChange}
            className={inputClass}
          />
        </FormField>

        <div>
          <div className="text-sm font-medium text-muted mb-1">Permissions</div>
          {isSystemRole ? (
            <p className="rounded-md border border-line bg-subtle p-3 text-sm text-muted">
              <i className="fa fa-shield-halved mr-1.5 text-primary"></i>
              Role sistem ini memiliki akses penuh ke semua menu dan operasi, dan tidak dapat diubah.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted mb-2">
                <b>View</b> = membuka menu, melihat tabel, mencari, dan melihat detail.
                Mencentang Create/Update/Delete otomatis mencentang View.
              </p>
              <PermissionMatrix
                resources={registry.resources}
                actions={registry.actions}
                value={form.permissions}
                onChange={(permissions) => crud.setForm((prev) => ({ ...prev, permissions }))}
              />
            </>
          )}
        </div>

        {editingRow && crud.mode !== 'create' && (
          <p className="text-sm text-muted">
            <i className="fa fa-users mr-1.5"></i>
            Dipakai oleh <b className="text-fg">{editingRow.userCount ?? 0}</b> user.
          </p>
        )}

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
