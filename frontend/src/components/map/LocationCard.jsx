import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getMapSummary } from '../../services/mapService';
import { LAYER_META, detailLink } from '../../utils/mapMeta';
import { mapUrl } from '../../utils/regionMeta';
import { formatNumber, formatRupiah } from '../../utils/formatHelper';
import { formatDay } from '../../utils/dateHelper';

const formatValue = (it) => {
  if (it.value === null || it.value === undefined || it.value === '') return '-';
  if (it.format === 'money') return formatRupiah(it.value);
  if (it.format === 'number') return formatNumber(it.value);
  if (it.format === 'date') return formatDay(it.value);
  return String(it.value);
};

/**
 * Kartu lokasi terpilih di peta, 2 tingkat: info ringkas langsung (dari data titik), lalu "Lihat ringkasan"
 * memuat angka dari server (GET /api/map/summary, disaring izin). Pasang dengan key = titik supaya state reset.
 */
export default function LocationCard({ point, onClose }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const meta = LAYER_META[point.type];

  const loadSummary = async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await getMapSummary(user.token, point.type, point.id));
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat ringkasan.');
    } finally {
      setLoading(false);
    }
  };

  const lines = [
    point.address,
    point.place,
    point.type === 'vendor' ? point.pic : point.phone,
    point.type === 'outlet' && point.gudang ? `Stok dari ${point.gudang}` : '',
  ].filter(Boolean);

  return (
    <div role="dialog" aria-label={`${meta.label} ${point.name}`}
      className="w-full sm:w-80 max-h-full overflow-y-auto rounded-lg border border-line bg-surface text-fg shadow-xl">
      <div className="flex items-start gap-3 p-3 border-b border-line-soft">
        <span className={`map-marker--${point.type} map-legend-dot shrink-0 mt-1`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-muted">{meta.label}{point.code ? ` · ${point.code}` : ''}</div>
          <h3 className="font-semibold leading-snug break-words">{point.name}</h3>
          <div className="flex flex-wrap gap-1 mt-1">
            {point.overdue && <span className="text-xs px-1.5 py-0.5 rounded bg-danger-soft text-danger">Lewat jatuh tempo</span>}
            {point.shiftOpen === true && <span className="text-xs px-1.5 py-0.5 rounded bg-success-soft text-success-fg">Shift buka</span>}
            {point.isActive === false && <span className="text-xs px-1.5 py-0.5 rounded bg-subtle text-muted">Nonaktif</span>}
            {point.type === 'gudang' && point.accessible === false && <span className="text-xs px-1.5 py-0.5 rounded bg-subtle text-muted">Tanpa akses</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Tutup" className="w-7 h-7 rounded-md hover:bg-subtle text-muted shrink-0">
          <i className="fa fa-xmark" aria-hidden="true"></i>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {lines.length > 0 && (
          <ul className="text-sm text-muted space-y-0.5 break-words">
            {lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        )}

        {summary ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {summary.items.map((it) => (
              <div key={it.label} className="contents">
                <dt className="text-muted">{it.label}</dt>
                <dd className={`text-right tabular-nums ${it.tone === 'danger' ? 'text-danger font-semibold' : 'text-fg'}`}>{formatValue(it)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <button type="button" onClick={loadSummary} disabled={loading}
            className="w-full px-3 py-1.5 rounded-md border border-line text-sm hover:bg-subtle disabled:opacity-60">
            <i className={`fa ${loading ? 'fa-spinner fa-spin' : 'fa-chart-simple'} mr-1.5`} aria-hidden="true"></i>Lihat ringkasan
          </button>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          <Link to={detailLink(point)} className="px-3 py-1.5 rounded-md bg-primary hover:bg-primary-hover text-primary-fg text-sm">Buka detail</Link>
          <a href={mapUrl(point.lat, point.lng)} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-md border border-line text-sm hover:bg-subtle">
            <i className="fa fa-arrow-up-right-from-square mr-1.5" aria-hidden="true"></i>Google Maps
          </a>
        </div>
      </div>
    </div>
  );
}
