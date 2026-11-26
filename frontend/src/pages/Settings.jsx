import { useEffect, useMemo, useState } from 'react';
import { getSettings, updateSettings } from '../services/purchaseService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import { inputClass } from '../utils/formStyles';

/**
 * System Settings (variabel global): form dibangun dari registri backend (config/settings.js),
 * dikelompokkan per `group`. Lihat butuh setting:view, simpan butuh setting:update.
 * Dokumen menyalin nilai setting saat dibuat/diterbitkan (mis. PO), jadi perubahan tidak mengubah dokumen lama.
 */
export default function Settings() {
  const { user } = useAuth();
  const perm = usePermission('setting');
  const toast = useToast();
  const [definitions, setDefinitions] = useState([]);
  const [saved, setSaved] = useState({});
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings(user.token)
      .then((data) => {
        setDefinitions(data.definitions);
        setSaved(data.values);
        setValues(data.values);
      })
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load settings'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  const groups = useMemo(() => {
    const map = new Map();
    definitions.forEach((d) => map.set(d.group, [...(map.get(d.group) || []), d]));
    return [...map.entries()];
  }, [definitions]);

  const changed = definitions.filter((d) => String(values[d.key]) !== String(saved[d.key]));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = Object.fromEntries(changed.map((d) => [d.key, d.type === 'number' ? Number(values[d.key]) : values[d.key]]));
      const res = await updateSettings(payload, user.token);
      toast.success(res.data.message);
      setSaved(res.data.data);
      setValues(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const field = (d) => {
    const id = `setting-${d.key}`;
    if (d.type === 'bool') {
      return (
        <label htmlFor={id} className="flex items-start gap-3 cursor-pointer">
          <input
            id={id}
            type="checkbox"
            checked={!!values[d.key]}
            onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.checked }))}
            className="mt-1 w-4 h-4 accent-primary"
          />
          <span>
            <span className="font-medium text-fg">{d.label}</span>
            {d.description && <span className="block text-xs text-muted">{d.description}</span>}
          </span>
        </label>
      );
    }
    if (d.multiline) {
      return (
        <div>
          <label htmlFor={id} className="block text-sm font-medium text-fg mb-1">{d.label}</label>
          <textarea
            id={id}
            rows={3}
            maxLength={d.maxLength}
            value={values[d.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
            className={`${inputClass} max-w-xl`}
          />
          {d.description && <p className="text-xs text-muted mt-1">{d.description}</p>}
        </div>
      );
    }
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-fg mb-1">{d.label}</label>
        <input
          id={id}
          type={d.type === 'number' ? 'number' : 'text'}
          step={d.type === 'number' ? '0.01' : undefined}
          min={d.min}
          max={d.max}
          maxLength={d.maxLength}
          value={values[d.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
          className={`${inputClass} ${d.type === 'text' ? 'max-w-xl' : 'max-w-xs'}`}
        />
        {d.description && <p className="text-xs text-muted mt-1">{d.description}</p>}
      </div>
    );
  };

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader fallbackTitle="System Settings" />

      <form onSubmit={save} className="space-y-4 max-w-3xl">
        <fieldset disabled={!perm.canUpdate || saving} className="space-y-4">
          {groups.map(([group, defs]) => (
            <section key={group} className="rounded-lg border border-line bg-surface p-4 space-y-4">
              <h3 className="font-semibold text-fg">{group}</h3>
              {defs.map((d) => <div key={d.key}>{field(d)}</div>)}
            </section>
          ))}
        </fieldset>

        {perm.canUpdate ? (
          <div className="flex items-center justify-end gap-2">
            {changed.length > 0 && (
              <button type="button" onClick={() => setValues(saved)} className="px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer">
                Reset
              </button>
            )}
            <button
              type="submit"
              disabled={!changed.length || saving}
              className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa fa-save"></i> {saving ? 'Saving...' : `Save${changed.length ? ` (${changed.length})` : ''}`}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted"><i className="fa fa-lock mr-1.5"></i>Baca saja (tidak ada izin mengubah).</p>
        )}
        <p className="text-xs text-muted">
          Perubahan berlaku untuk dokumen baru. Dokumen yang sudah dibuat menyimpan nilai saat itu. Riwayat perubahan ada di Audit Log (type: System Settings).
        </p>
      </form>
    </div>
  );
}
