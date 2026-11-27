import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import LocationMap from '../components/map/LocationMap';
import LocationCard from '../components/map/LocationCard';
import { getMapPoints } from '../services/mapService';
import { getRegionChildren } from '../services/regionService';
import { LAYER_META, LAYER_ORDER, flattenPoints, filterPoints, detailLink } from '../utils/mapMeta';
import { inputClass } from '../utils/formStyles';
import { formatNumber } from '../utils/formatHelper';

const VISIBLE_KEY = 'mapLayers';
const readVisible = () => {
  try {
    const v = JSON.parse(localStorage.getItem(VISIBLE_KEY));
    if (Array.isArray(v)) return v.filter((x) => LAYER_ORDER.includes(x));
  } catch { /* abaikan */ }
  return LAYER_ORDER;
};

/**
 * Halaman Peta (/map, izin map:view): outlet, gudang, vendor & customer yang boleh dilihat user dalam 1 peta.
 * Filter lapisan / wilayah / cari / overdue di sisi klien; klik marker -> kartu lokasi (ringkas + "Lihat ringkasan").
 * Daftar "Belum ada titik" mengarah ke data master untuk dilengkapi lewat "Pilih di peta".
 */
export default function MapPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [layers, setLayers] = useState(null);
  const [visible, setVisible] = useState(readVisible);
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [openMissing, setOpenMissing] = useState(null);
  const [loadCount, setLoadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      setLayers((await getMapPoints(user.token)).layers);
      setLoadCount((n) => n + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal memuat data peta.');
      setLayers({});
    }
  }, [user.token, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getRegionChildren(user.token, '').then(setProvinces).catch(() => {}); }, [user.token]);
  useEffect(() => {
    setCities([]);
    if (province) getRegionChildren(user.token, province).then(setCities).catch(() => {});
  }, [province, user.token]);
  useEffect(() => {
    try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(visible)); } catch { /* abaikan */ }
  }, [visible]);

  const available = LAYER_ORDER.filter((t) => layers?.[t]);
  const all = useMemo(() => flattenPoints(layers), [layers]);
  const region = city || province;
  const points = useMemo(
    () => filterPoints(all, { visible, region, search, overdueOnly, showInactive }),
    [all, visible, region, search, overdueOnly, showInactive],
  );
  const hasOverdueFlag = layers?.customer?.points?.[0]?.overdue !== undefined;
  const counts = Object.fromEntries(LAYER_ORDER.map((t) => [t, points.filter((p) => p.type === t).length]));
  const fitKey = `${loadCount}|${visible.join(',')}|${region}|${overdueOnly}|${showInactive}`;
  const missing = available.map((t) => ({ type: t, items: (layers[t].missing || []).filter((m) => showInactive || m.isActive !== false) }))
    .filter((x) => x.items.length);

  // titik terpilih yang tersaring keluar -> tutup kartunya
  useEffect(() => {
    if (selected && !points.some((p) => p.key === selected.key)) setSelected(null);
  }, [points, selected]);

  const toggle = (t) => setVisible((v) => (v.includes(t) ? v.filter((x) => x !== t) : LAYER_ORDER.filter((x) => x === t || v.includes(x))));

  return (
    // mobile: halaman bisa di-scroll (peta tinggi tetap, filter di bawahnya); lg: setinggi layar, panel filter scroll sendiri
    <div className="h-full p-4 flex flex-col gap-4 min-h-0 overflow-y-auto lg:overflow-hidden">
      <PageHeader fallbackTitle="Map" />
      {!layers ? (
        <div className="p-6 text-muted">Loading...</div>
      ) : available.length === 0 ? (
        <p className="text-muted">Tidak ada lapisan peta untuk role Anda (butuh izin lihat Outlet, Warehouse, Vendor, atau Customer).</p>
      ) : (
        <div className="grid gap-4 lg:flex-1 lg:min-h-0 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-4 lg:overflow-y-auto min-w-0 order-2 lg:order-none">
            <section className="rounded-lg border border-line bg-surface p-3 space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-muted">Layers</h3>
              {available.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={visible.includes(t)} onChange={() => toggle(t)} />
                  <span className={`map-marker--${t} map-legend-dot`} aria-hidden="true" />
                  <span className="flex-1">{LAYER_META[t].label}</span>
                  <span className="tabular-nums text-muted">{formatNumber(counts[t])}</span>
                </label>
              ))}
            </section>

            <section className="rounded-lg border border-line bg-surface p-3 space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-muted">Filter</h3>
              <input type="search" aria-label="Cari lokasi" placeholder="Cari nama / kode / wilayah" value={search}
                onChange={(e) => setSearch(e.target.value)} className={inputClass} />
              <select aria-label="Provinsi" value={province} onChange={(e) => { setProvince(e.target.value); setCity(''); }} className={inputClass}>
                <option value="">Semua provinsi</option>
                {provinces.map((p) => <option key={p.kode} value={p.kode}>{p.name}</option>)}
              </select>
              <select aria-label="Kota / kabupaten" value={city} onChange={(e) => setCity(e.target.value)} disabled={!province} className={inputClass}>
                <option value="">{province ? 'Semua kota / kabupaten' : '—'}</option>
                {cities.map((c) => <option key={c.kode} value={c.kode}>{c.name}</option>)}
              </select>
              {hasOverdueFlag && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
                  Customer lewat jatuh tempo saja
                </label>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Tampilkan yang nonaktif
              </label>
              {region && <p className="text-xs text-muted">Filter wilayah hanya untuk data yang wilayahnya dipilih dari daftar.</p>}
            </section>

            {missing.length > 0 && (
              <section className="rounded-lg border border-line bg-surface p-3 space-y-2">
                <h3 className="text-xs uppercase tracking-wider text-muted">Belum ada titik</h3>
                {missing.map(({ type, items }) => (
                  <div key={type}>
                    <button type="button" onClick={() => setOpenMissing(openMissing === type ? null : type)}
                      className="w-full flex items-center justify-between text-sm py-1 hover:text-primary" aria-expanded={openMissing === type}>
                      <span>{LAYER_META[type].label}</span>
                      <span className="tabular-nums text-warning-fg">{formatNumber(items.length)} <i className={`fa fa-chevron-${openMissing === type ? 'up' : 'down'} text-xs ml-1`} aria-hidden="true"></i></span>
                    </button>
                    {openMissing === type && (
                      <ul className="max-h-48 overflow-y-auto text-sm border-l border-line pl-2 space-y-0.5">
                        {items.map((m) => (
                          <li key={m.id}>
                            <Link to={detailLink({ ...m, type })} className="hover:text-primary hover:underline break-words">
                              {m.name}{m.code ? <span className="text-muted"> · {m.code}</span> : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted">Buka datanya lalu isi lokasi lewat &quot;Pilih di peta&quot;.</p>
              </section>
            )}
          </aside>

          {/* mobile: peta di atas dengan tinggi tetap supaya sisa layar tetap bisa di-scroll dengan sentuhan */}
          <div className="relative isolate h-[55vh] min-h-[20rem] lg:h-auto lg:min-h-[26rem] rounded-lg border border-line overflow-hidden order-1 lg:order-none">
            <LocationMap points={points} selectedKey={selected?.key} onSelect={setSelected} fitKey={fitKey} className="absolute inset-0" />
            {points.length === 0 && (
              <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-[500]">
                <span className="rounded-md bg-surface/95 border border-line px-3 py-1.5 text-sm text-muted shadow">Tidak ada lokasi yang cocok dengan filter.</span>
              </div>
            )}
            {selected && (
              <div className="absolute z-[600] left-2 right-2 bottom-2 sm:right-auto max-h-[calc(100%-1rem)] flex">
                <LocationCard key={selected.key} point={selected} onClose={() => setSelected(null)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
