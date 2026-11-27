import { useEffect, useRef } from 'react';
import L from './leafletSetup';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import {
  TILE_URL, TILE_ATTRIBUTION, TILE_MAX_ZOOM, INDONESIA_VIEW, LAYER_META, LAYER_ORDER, pointsBounds,
} from '../../utils/mapMeta';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Marker bulat berwarna per lapisan (CSS .map-marker--<type> di index.css) + penanda overdue / nonaktif / terpilih */
const markerIcon = (p, selected) => L.divIcon({
  className: [
    'map-marker', `map-marker--${p.type}`,
    p.overdue ? 'is-overdue' : '', p.isActive === false ? 'is-inactive' : '', selected ? 'is-selected' : '',
  ].filter(Boolean).join(' '),
  html: `<span><i class="fa ${LAYER_META[p.type].icon}"></i>${p.overdue ? '<b>!</b>' : ''}</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/**
 * Peta lokasi (halaman Peta & widget dashboard). `points` = titik yang sudah disaring ([{ key, type, lat, lng, ... }]);
 * customer dikelompokkan (cluster) saat berdekatan. Peta menyesuaikan batas setiap `fitKey` berubah.
 * onSelect(point) saat marker diklik (opsional).
 */
export default function LocationMap({ points, selectedKey = null, onSelect, fitKey, className = '' }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const groupsRef = useRef({});
  const markersRef = useRef(new Map());
  const pointsRef = useRef(points);
  const onSelectRef = useRef(onSelect);
  pointsRef.current = points;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const map = L.map(boxRef.current, { zoomControl: true });
    L.tileLayer(TILE_URL, { maxZoom: TILE_MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.setView([INDONESIA_VIEW.lat, INDONESIA_VIEW.lng], INDONESIA_VIEW.zoom);
    LAYER_ORDER.forEach((type) => {
      groupsRef.current[type] = (type === 'customer'
        ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true })
        : L.layerGroup()).addTo(map);
    });
    mapRef.current = map;
    // ukuran kontainer bisa berubah (sidebar dibuka/ditutup, layar diputar)
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(boxRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      groupsRef.current = {};
      markersRef.current = new Map();
    };
  }, []);

  // gambar ulang marker saat titik berubah
  useEffect(() => {
    if (!mapRef.current) return;
    Object.values(groupsRef.current).forEach((g) => g.clearLayers());
    const markers = new Map();
    points.forEach((p) => {
      const m = L.marker([p.lat, p.lng], { icon: markerIcon(p, p.key === selectedKey), keyboard: true, title: p.name, riseOnHover: true });
      m.bindTooltip(`${escapeHtml(p.name)}${p.code ? ` <span class="opacity-70">${escapeHtml(p.code)}</span>` : ''}`, { direction: 'top', offset: [0, -14] });
      m.on('click', () => onSelectRef.current?.(p));
      groupsRef.current[p.type]?.addLayer(m);
      markers.set(p.key, m);
    });
    markersRef.current = markers;
    // selectedKey sengaja tidak jadi dependensi: penanda terpilih diperbarui di effect berikut
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // tandai marker terpilih
  useEffect(() => {
    markersRef.current.forEach((m, key) => {
      const p = pointsRef.current.find((x) => x.key === key);
      if (!p) return;
      m.setIcon(markerIcon(p, key === selectedKey));
      m.setZIndexOffset(key === selectedKey ? 1000 : 0);
    });
  }, [selectedKey]);

  // sesuaikan batas peta
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = pointsBounds(pointsRef.current);
    if (!bounds) map.setView([INDONESIA_VIEW.lat, INDONESIA_VIEW.lng], INDONESIA_VIEW.zoom);
    else map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
  }, [fitKey]);

  return <div ref={boxRef} className={`bg-subtle ${className}`} />;
}
