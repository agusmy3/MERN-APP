import { useEffect, useState } from 'react';
import FormField from './FormField';
import { inputClass } from '../utils/formStyles';
import { useAuth } from '../context/AuthContext';
import { getRegionChildren, getRegion, searchRegions } from '../services/regionService';
import {
  REGION_LEVELS, mapUrl, regionChain, legacyRegionText, pickRegion, regionFromPath,
} from '../utils/regionMeta';

/**
 * Wilayah dari master (Provinsi -> Kota/Kab -> Kecamatan -> Kelurahan/Desa, dropdown berantai + cari cepat),
 * kode pos (otomatis dari kelurahan, bisa diubah) & koordinat. Dipakai Customer, Vendor, Gudang, Outlet,
 * alamat kirim SO. Alamat jalan ada di field masing-masing form. `setForm` = setter (updater function).
 */
export default function RegionFields({ form, setForm, idPrefix, showCoordinates = true }) {
  const { user } = useAuth();
  const chain = regionChain(form.regionCode);
  const parents = ['', ...chain].slice(0, 4); // parent untuk daftar tiap tingkat
  const [lists, setLists] = useState({});    // parent -> anak
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);
  const [searching, setSearching] = useState(false);

  const parentKey = parents.join('|');
  useEffect(() => {
    let alive = true;
    parentKey.split('|').forEach((p) => {
      getRegionChildren(user.token, p)
        .then((items) => { if (alive) setLists((prev) => (prev[p] === items ? prev : { ...prev, [p]: items })); })
        .catch(() => { if (alive) setFailed(true); });
    });
    return () => { alive = false; };
  }, [parentKey, user.token]);

  // cari cepat (min. 3 huruf, debounce)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setHits(null); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchRegions(user.token, q, { limit: 15 })
        .then((data) => { if (alive) setHits(data); })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, user.token]);

  const choose = (level, kode) => {
    const item = kode ? (lists[parents[level]] || []).find((r) => r.kode === kode) : null;
    setForm((prev) => pickRegion(prev, level, item));
  };
  const chooseHit = async (hit) => {
    setQuery('');
    setHits(null);
    try {
      const detail = await getRegion(user.token, hit.kode);
      setForm((prev) => regionFromPath(prev, detail.path));
    } catch {
      setFailed(true);
    }
  };

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));
  const legacy = legacyRegionText(form);
  const validCoord = form.latitude && form.longitude && !Number.isNaN(Number(form.latitude)) && !Number.isNaN(Number(form.longitude));

  return (
    <>
      <div className="relative">
        <FormField label="Find region" htmlFor={`${idPrefix}-region-search`}
          hint="Ketik nama kelurahan / kecamatan / kota (min. 3 huruf), atau pilih bertahap di bawah.">
          <input id={`${idPrefix}-region-search`} type="search" autoComplete="off" placeholder="e.g. Cipaganti"
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setHits(null); } if (e.key === 'Enter') e.preventDefault(); }}
            className={inputClass} />
        </FormField>
        {(hits || searching) && (
          <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
            {searching && !hits && <p className="px-3 py-2 text-sm text-muted">Mencari…</p>}
            {hits && hits.length === 0 && <p className="px-3 py-2 text-sm text-muted">Tidak ditemukan.</p>}
            {hits?.map((h) => (
              <button key={h.kode} type="button" onClick={() => chooseHit(h)}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-subtle focus:bg-subtle focus:outline-none">
                <span className="text-fg">{h.path}</span>
                <span className="ml-2 text-xs text-muted">{REGION_LEVELS[h.level - 1].label}{h.kodePos ? ` · ${h.kodePos}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {REGION_LEVELS.map((l, i) => {
          const parent = parents[i];
          const enabled = i === 0 || Boolean(chain[i - 1]);
          const items = enabled ? lists[parent] : null;
          const value = chain[i] || '';
          return (
            <FormField key={l.field} label={l.label} htmlFor={`${idPrefix}-${l.field}`}>
              <select id={`${idPrefix}-${l.field}`} value={value} disabled={!enabled || !items}
                onChange={(e) => choose(i, e.target.value)} className={inputClass}>
                <option value="">{!enabled ? '—' : items ? `Select ${l.label.toLowerCase()}` : 'Loading…'}</option>
                {/* kode tersimpan yang tidak ada di daftar (wilayah nonaktif) tetap ditampilkan */}
                {value && items && !items.some((r) => r.kode === value) && <option value={value}>{form[l.field] || value}</option>}
                {items?.map((r) => <option key={r.kode} value={r.kode}>{r.name}</option>)}
              </select>
            </FormField>
          );
        })}
      </div>

      {failed && <p className="text-xs text-danger">Gagal memuat data wilayah. Muat ulang halaman, atau jalankan `npm run regions:import` di backend.</p>}
      {legacy.length > 0 && (
        <div className="rounded-md bg-warning-soft text-warning-fg px-3 py-2 text-xs">
          Wilayah lama (teks): {legacy.map((x) => `${x.label} "${x.value}"`).join(', ')}. Pilih dari daftar di atas untuk
          memperbarui{chain.length ? '; teks di bawah wilayah terpilih dihapus saat disimpan' : ''}.
        </div>
      )}

      <FormField label="Postal Code" htmlFor={`${idPrefix}-kodepos`} hint="5 digit. Terisi otomatis dari kelurahan, bisa diubah.">
        <input id={`${idPrefix}-kodepos`} autoComplete="off" inputMode="numeric" maxLength={5} placeholder="12345"
          value={form.kodePos} onChange={(e) => set('kodePos', e.target.value.replace(/\D/g, '').slice(0, 5))} className={inputClass} />
      </FormField>

      {showCoordinates && (
        <FormField label="Coordinates" htmlFor={`${idPrefix}-lat`}
          hint={'Derajat desimal (WGS84). Bisa tempel langsung "lat, long" dari Google Maps ke kolom Latitude.'}>
          <div className="grid grid-cols-2 gap-4">
            <input id={`${idPrefix}-lat`} aria-label="Latitude" inputMode="decimal" autoComplete="off" placeholder="Latitude, e.g. -6.2088"
              value={form.latitude}
              onChange={(e) => {
                const v = e.target.value;
                // "lat, long" ditempel sekaligus -> pecah ke dua kolom
                const parts = v.split(',').map((x) => x.trim());
                if (parts.length === 2 && parts.every((x) => x !== '' && !Number.isNaN(Number(x)))) {
                  setForm((prev) => ({ ...prev, latitude: parts[0], longitude: parts[1] }));
                } else set('latitude', v);
              }}
              className={inputClass} />
            <input aria-label="Longitude" inputMode="decimal" autoComplete="off" placeholder="Longitude, e.g. 106.8456"
              value={form.longitude} onChange={(e) => set('longitude', e.target.value)} className={inputClass} />
          </div>
          {validCoord && (
            <a href={mapUrl(form.latitude, form.longitude)} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-1 text-xs text-primary hover:underline">
              <i className="fa fa-location-dot mr-1"></i>Lihat di Google Maps
            </a>
          )}
        </FormField>
      )}
    </>
  );
}
