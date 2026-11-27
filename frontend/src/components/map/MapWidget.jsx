import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LocationMap from './LocationMap';
import { getMapPoints } from '../../services/mapService';
import { LAYER_META, LAYER_ORDER, flattenPoints, filterPoints } from '../../utils/mapMeta';
import { formatNumber } from '../../utils/formatHelper';

/** Widget dashboard (izin map:view): peta kecil semua lokasi aktif + jumlah per lapisan + "Buka peta". */
export default function MapWidget() {
  const { user } = useAuth();
  const [layers, setLayers] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getMapPoints(user.token)
      .then((d) => { if (alive) setLayers(d.layers); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [user.token]);

  const points = useMemo(() => filterPoints(flattenPoints(layers)), [layers]);
  const available = LAYER_ORDER.filter((t) => layers?.[t]);
  if (failed || (layers && available.length === 0)) return null;
  const missingTotal = available.reduce((s, t) => s + (layers[t].missing || []).filter((m) => m.isActive !== false).length, 0);
  const overdue = points.filter((p) => p.overdue).length;

  return (
    <section className="rounded-lg border border-line bg-surface p-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-fg"><i className="fa fa-map-location-dot mr-2 text-muted" aria-hidden="true"></i>Locations</h3>
        <Link to="/map" className="text-sm text-primary hover:underline">Buka peta <i className="fa fa-arrow-right text-xs" aria-hidden="true"></i></Link>
      </div>
      {!layers ? <div className="h-72 rounded-md bg-subtle animate-pulse" /> : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-3">
            {available.map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={`map-marker--${t} map-legend-dot`} aria-hidden="true" />
                {LAYER_META[t].label} <span className="tabular-nums font-semibold">{formatNumber(points.filter((p) => p.type === t).length)}</span>
              </span>
            ))}
            {overdue > 0 && <span className="text-danger">{formatNumber(overdue)} customer lewat jatuh tempo</span>}
            {missingTotal > 0 && <Link to="/map" className="text-warning-fg hover:underline">{formatNumber(missingTotal)} belum ada titik</Link>}
          </div>
          <div className="relative isolate h-72 rounded-md border border-line overflow-hidden">
            <LocationMap points={points} fitKey={points.length} className="absolute inset-0" />
          </div>
        </>
      )}
    </section>
  );
}
