import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getMenuDropdown,
  getMenus,
  createMenu,
  updateMenu,
  deleteMenu
} from '../services/menuService';
import { getRoleResources } from '../services/roleService';
import { useAuth } from '../context/AuthContext';
import useMenus from '../hooks/useMenus';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import FormField from '../components/FormField';
import TruncateText from '../components/TruncateText';
import { AuditDetail } from '../components/AuditInfo';
import { historyAside } from '../utils/historyAside';
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { inputClass } from '../utils/formStyles';

const EMPTY_FORM = {
  menu: '',
  parent_id: '',
  component: '',
  img: '',
  icon: '',
  deskripsi: '',
  resource: ''
};

// id menu beserta seluruh turunannya, supaya menu tidak bisa dipindah ke bawah anak/cucunya sendiri
const getSelfAndDescendantIds = (id, menus) => {
  const ids = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const m of menus) {
      const parentId = m.parent_id?._id ?? m.parent_id;
      if (parentId && ids.has(String(parentId)) && !ids.has(m._id)) {
        ids.add(m._id);
        added = true;
      }
    }
  }
  return ids;
};

export default function Menu() {
  const { user } = useAuth();
  // pohon menu bersama (sidebar + judul halaman), dimuat ulang setelah data menu berubah
  const { reloadMenus } = useMenus();

  const fetchMenus = useCallback(async (params) => {
    const res = await getMenus(user.token, params);
    return { items: res.data.data.dataMenu, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchMenus, { defaultSortField: 'createdDate', defaultSortOrder: 'asc' });

  // semua menu untuk pilihan Parent (endpoint /dropdown: _id, menu, parent_id)
  const [listAll, setListAll] = useState([]);
  const loadAllMenus = useCallback(async () => {
    try {
      setListAll(await getMenuDropdown(user.token));
    } catch (err) {
      console.error(err);
    }
  }, [user.token]);

  useEffect(() => {
    loadAllMenus();
  }, [loadAllMenus]);

  // daftar resource izin (untuk field Resource): [{ key, label, group }]
  const [resources, setResources] = useState([]);
  useEffect(() => {
    getRoleResources(user.token)
      .then((data) => setResources(data.resources))
      .catch((err) => console.error(err));
  }, [user.token]);

  const menuName = useMemo(() => new Map(listAll.map((m) => [m._id, m.menu])), [listAll]);
  const resourceLabel = useMemo(() => new Map(resources.map((r) => [r.key, r.label])), [resources]);

  const crud = useCrudDrawer({
    entityName: 'Menu',
    resource: 'menu',
    emptyForm: EMPTY_FORM,
    toForm: (row) => ({
      menu: row.menu,
      parent_id: row.parent_id?._id || '',
      component: row.component || '',
      img: row.img || '',
      icon: row.icon || '',
      deskripsi: row.deskripsi || '',
      resource: row.resource || ''
    }),
    getLabel: (row) => row.menu,
    create: (payload) => createMenu(payload, user.token),
    update: (id, payload) => updateMenu(id, payload, user.token),
    remove: (id) => deleteMenu(id, user.token),
    onSaved: () => {
      table.reload();
      loadAllMenus();
      reloadMenus();
    },
    onDeleted: () => {
      table.reloadAfterDelete();
      loadAllMenus();
      reloadMenus();
    },
  });

  const { editingRow, form } = crud;

  const parentOptions = useMemo(() => {
    if (!editingRow) return listAll;
    const excluded = getSelfAndDescendantIds(editingRow._id, listAll);
    return listAll.filter((m) => !excluded.has(m._id));
  }, [listAll, editingRow]);

  const columns = [
    {
      key: 'menu',
      header: 'Menu',
      sortField: 'menu',
      width: 240,
      render: (m) => (
        <div className="flex items-center gap-2 min-w-0">
          <i className={`${m.icon || 'fa fa-circle text-[6px]'} w-5 shrink-0 text-center text-muted`}></i>
          <TruncateText text={m.menu} className="font-medium" />
        </div>
      ),
    },
    {
      key: 'parent',
      header: 'Parent',
      sortField: 'parent_id',
      width: 180,
      render: (m) => m.parent_id?.menu || <span className="text-muted italic">Root</span>,
    },
    {
      key: 'component',
      header: 'Route',
      width: 180,
      render: (m) => m.component
        ? <TruncateText text={m.component} className="font-mono text-xs" />
        : null,
    },
    {
      key: 'resource',
      header: 'Permission',
      width: 160,
      render: (m) => {
        if (m.resource) return resourceLabel.get(m.resource) || m.resource;
        return <span className="text-muted italic">{m.component ? 'All users' : 'Group'}</span>;
      },
    },
    auditColumn(table.sortField),
    actionColumn(crud),
  ];

  return (
    <DataPage
      fallbackTitle="Menu"
      entityName="Menu"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps} aside={historyAside(crud, 'menu')}>
        <FormField label="Name" htmlFor="menu-name" required>
          <input
            id="menu-name"
            type='text'
            name='menu'
            placeholder="e.g. Unit of Measure"
            value={form.menu}
            onChange={crud.handleChange}
            autoComplete='off'
            autoFocus
            className={inputClass}
            required
          />
        </FormField>

        <FormField
          label="Description"
          htmlFor="menu-deskripsi"
          hint="Tampil sebagai subjudul di bawah judul halaman. Opsional."
        >
          <textarea
            id="menu-deskripsi"
            name="deskripsi"
            rows={2}
            placeholder="e.g. Satuan yang dipakai untuk stok produk"
            value={form.deskripsi}
            onChange={crud.handleChange}
            className={inputClass}
          />
        </FormField>

        <FormField label="Parent" htmlFor="menu-parent">
          <select
            id="menu-parent"
            name='parent_id'
            value={form.parent_id}
            onChange={crud.handleChange}
            className={`${inputClass} text-fg`}
          >
            <option value=''>-- (Root) --</option>
            {parentOptions.map((p) => (
              <option key={p._id} value={p._id}>
                {p.parent_id && menuName.get(p.parent_id) ? `${menuName.get(p.parent_id)} › ${p.menu}` : p.menu}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Route"
          htmlFor="menu-component"
          hint="Path halaman yang terdaftar di App.jsx. Kosongkan untuk menu grup (hanya punya submenu)."
        >
          <input
            id="menu-component"
            type='text'
            name='component'
            placeholder="e.g. /uom"
            value={form.component}
            onChange={crud.handleChange}
            autoComplete='off'
            className={inputClass}
          />
        </FormField>

        <FormField
          label="Permission"
          htmlFor="menu-resource"
          hint="Menu hanya tampil di sidebar untuk role yang punya akses View ke resource ini. Kosongkan untuk halaman yang boleh dibuka semua user (mis. Dashboard)."
        >
          <select
            id="menu-resource"
            name="resource"
            value={form.resource}
            onChange={crud.handleChange}
            className={`${inputClass} text-fg`}
          >
            <option value="">-- All users / group --</option>
            {resources.map((r) => (
              <option key={r.key} value={r.key}>{r.group} › {r.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Icon" htmlFor="menu-icon" hint="Class Font Awesome, pratinjau tampil di kiri.">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 shrink-0 rounded bg-side text-side-fg flex items-center justify-center">
              <i className={form.icon || 'fa fa-question text-muted'}></i>
            </span>
            <input
              id="menu-icon"
              type='text'
              name='icon'
              placeholder="e.g. fa-solid fa-ruler"
              value={form.icon}
              onChange={crud.handleChange}
              autoComplete='off'
              className={inputClass}
            />
          </div>
        </FormField>

        <FormField label="Image" htmlFor="menu-img">
          <input
            id="menu-img"
            type='text'
            name='img'
            value={form.img}
            onChange={crud.handleChange}
            autoComplete='off'
            className={inputClass}
          />
        </FormField>

        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
