import { Fragment, useEffect, useRef } from 'react';

const ACTION_LABEL = { view: 'View', create: 'Create', update: 'Update', delete: 'Delete', post: 'Post', approve: 'Approve' };

/** Checkbox yang bisa tampil "sebagian" (indeterminate) untuk kolom/baris yang tercentang sebagian. */
function TriCheckbox({ checked, indeterminate, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-default"
    />
  );
}

/**
 * Matriks izin Role: baris = resource (dikelompokkan per `group`), kolom = action.
 *
 * value    : { produk: ['view', 'create'], ... }
 * onChange : (nextValue) => void
 * Aturan (sama dengan backend): mencentang Create/Update/Delete otomatis mencentang View;
 * melepas View melepas semua action di baris itu.
 * Mode baca saja: bungkus dengan <fieldset disabled> (FormDrawer readOnly sudah melakukannya).
 */
export default function PermissionMatrix({ resources, actions, value, onChange }) {
  const order = (set) => actions.filter((a) => set.has(a));
  // resource boleh membatasi action-nya (mis. Audit Log hanya View)
  const allowed = (r) => r.actions || actions;

  const setRow = (resource, nextActions) => {
    const next = { ...value };
    if (nextActions.length) next[resource] = nextActions;
    else delete next[resource];
    onChange(next);
  };

  const toggle = (resource, action, checked) => {
    const set = new Set(value[resource] || []);
    if (checked) {
      set.add(action);
      set.add('view');
    } else if (action === 'view') {
      set.clear();
    } else {
      set.delete(action);
    }
    setRow(resource, order(set));
  };

  const toggleColumn = (action, checked) => {
    const next = { ...value };
    for (const r of resources) {
      if (!allowed(r).includes(action)) continue;
      const set = new Set(next[r.key] || []);
      if (checked) {
        set.add(action);
        set.add('view');
      } else if (action === 'view') {
        set.clear();
      } else {
        set.delete(action);
      }
      const list = order(set);
      if (list.length) next[r.key] = list;
      else delete next[r.key];
    }
    onChange(next);
  };

  const has = (resource, action) => (value[resource] || []).includes(action);
  const columnCount = (action) => resources.filter((r) => has(r.key, action)).length;
  const columnSize = (action) => resources.filter((r) => allowed(r).includes(action)).length;
  const groups = [...new Set(resources.map((r) => r.group))];

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead className="bg-head text-head-fg">
          <tr>
            <th className="text-left font-semibold px-3 py-2 border-b border-line">Menu / Resource</th>
            {actions.map((a) => {
              const count = columnCount(a);
              return (
                <th key={a} className="font-semibold px-2 py-2 border-b border-line w-20">
                  <div className="flex flex-col items-center gap-1">
                    <span>{ACTION_LABEL[a] || a}</span>
                    <TriCheckbox
                      label={`Toggle ${ACTION_LABEL[a] || a} for all`}
                      checked={count === columnSize(a) && count > 0}
                      indeterminate={count > 0}
                      onChange={(checked) => toggleColumn(a, checked)}
                    />
                  </div>
                </th>
              );
            })}
            <th className="font-semibold px-2 py-2 border-b border-line w-14">All</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group}>
              <tr>
                <td colSpan={actions.length + 2} className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group}
                </td>
              </tr>
              {resources.filter((r) => r.group === group).map((r) => {
                const rowActions = value[r.key] || [];
                return (
                  <tr key={r.key} className="hover:bg-subtle">
                    <td className="px-3 py-2 border-t border-line-soft">{r.label}</td>
                    {actions.map((a) => (
                      <td key={a} className="px-2 py-2 border-t border-line-soft text-center">
                        {allowed(r).includes(a) ? (
                          <TriCheckbox
                            label={`${ACTION_LABEL[a] || a} ${r.label}`}
                            checked={has(r.key, a)}
                            onChange={(checked) => toggle(r.key, a, checked)}
                          />
                        ) : <span className="text-muted" title="Not applicable">–</span>}
                      </td>
                    ))}
                    <td className="px-2 py-2 border-t border-line-soft text-center">
                      <TriCheckbox
                        label={`All actions for ${r.label}`}
                        checked={rowActions.length === allowed(r).length}
                        indeterminate={rowActions.length > 0}
                        onChange={(checked) => setRow(r.key, checked ? [...allowed(r)] : [])}
                      />
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
