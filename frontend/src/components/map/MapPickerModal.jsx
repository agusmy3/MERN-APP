import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import useToast from '../../hooks/useToast';
import { useAuth } from '../../context/AuthContext';
import { getRegion } from '../../services/regionService';
import {
  TILE_URL, TILE_ATTRIBUTION, TILE_MAX_ZOOM, pickerView, formatPoint, roundCoord, geoErrorMessage,
} from '../../utils/mapMeta';

// pin memakai warna tema (bukan gambar marker bawaan Leaflet yang rusak saat dibundel)
const pinIcon = L.divIcon({
  className: 'map-pin',
  html: '<i class="fa fa-location-dot"></i>',
  iconSize: [32, 40],
  iconAnchor: [16, 38],
});

/**
 * Modal "Pilih di peta": klik peta untuk menaruh pin, geser pin untuk memperbaiki, atau "Lokasi saya".
 * Tampilan awal: titik yang ada -> pusat wilayah (regionCode) -> Indonesia. Di-portal ke body, di atas drawer.
 * onPick({ lat, lng }) saat "Gunakan titik ini". Pasang hanya saat dibuka (`{open && <MapPickerModal … />}`), supaya
 * pin awal selalu dari `point` terbaru. Esc menutup modal saja (drawer di belakangnya tetap terbuka).
 */
export default function MapPickerModal({ open = true, title, subtitle, point, regionCode, onClose, onPick }) {
  const { user } = useAuth();
  const toast = useToast();
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [pin, setPin] = useState(point || null);
  const [locating, setLocating] = useState(false);

  // buat peta saat dibuka, hapus saat ditutup
  useEffect(() => {
    if (!open || !boxRef.current) return undefined;
    let alive = true;
    const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: TILE_MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map);
    mapRef.current = map;
    const start = pickerView(point, null);
    map.setView([start.lat, start.lng], start.zoom);
    if (!point && regionCode) {
      getRegion(user.token, regionCode)
        .then((r) => {
          if (!alive) return;
          const v = pickerView(null, r.center);
          map.setView([v.lat, v.lng], v.zoom);
        })
        .catch(() => {});
    }
    map.on('click', (e) => setPin({ lat: roundCoord(e.latlng.lat), lng: roundCoord(e.latlng.lng) }));
    // ukuran kontainer baru pasti setelah modal tampil
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => {
      alive = false;
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // hanya saat dibuka; titik awal dibaca sekali
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // sinkronkan pin -> marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const m = L.marker([pin.lat, pin.lng], { icon: pinIcon, draggable: true, keyboard: true, title: 'Geser untuk memperbaiki titik' });
      m.on('dragend', () => {
        const ll = m.getLatLng();
        setPin({ lat: roundCoord(ll.lat), lng: roundCoord(ll.lng) });
      });
      m.addTo(map);
      markerRef.current = m;
    } else {
      markerRef.current.setLatLng([pin.lat, pin.lng]);
    }
  }, [pin, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const locate = () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      toast.warning('"Lokasi saya" butuh koneksi HTTPS (atau localhost). Klik titik di peta.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) };
        setPin(p);
        mapRef.current?.setView([p.lat, p.lng], 17);
        if (pos.coords.accuracy > 100) toast.info(`Akurasi lokasi sekitar ${Math.round(pos.coords.accuracy)} m. Geser pin bila perlu.`);
      },
      (err) => {
        setLocating(false);
        toast.warning(geoErrorMessage(err.code));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="map-picker-title"
        className="relative flex flex-col w-full h-full sm:h-[88vh] sm:max-w-5xl sm:rounded-lg border border-line bg-surface text-fg shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line">
          <div className="min-w-0">
            <h2 id="map-picker-title" className="font-semibold text-fg truncate">{title || 'Pilih lokasi'}</h2>
            <p className="text-xs text-muted truncate">{subtitle || 'Klik peta untuk menaruh pin, geser pin untuk memperbaiki.'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={locate} disabled={locating}
              className="px-3 py-1.5 rounded-md border border-line text-sm hover:bg-subtle disabled:opacity-60">
              <i className={`fa ${locating ? 'fa-spinner fa-spin' : 'fa-location-crosshairs'} mr-1.5`} aria-hidden="true"></i>Lokasi saya
            </button>
            <button type="button" onClick={onClose} aria-label="Tutup" className="w-8 h-8 rounded-md hover:bg-subtle text-muted">
              <i className="fa fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div ref={boxRef} className="flex-1 min-h-0 bg-subtle" />

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line">
          <div className="text-sm min-w-0">
            {pin ? (
              <span className="tabular-nums"><i className="fa fa-location-dot text-primary mr-1.5" aria-hidden="true"></i>{formatPoint(pin)}</span>
            ) : <span className="text-muted">Belum ada titik. Klik peta atau pakai "Lokasi saya".</span>}
            {pin && (
              <button type="button" onClick={() => setPin(null)} className="ml-3 text-xs text-muted hover:text-danger">Hapus pin</button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md border border-line text-sm hover:bg-subtle">Batal</button>
            <button type="button" disabled={!pin} onClick={() => onPick(pin)}
              className="px-4 py-2 rounded-md bg-primary hover:bg-primary-hover text-primary-fg text-sm disabled:opacity-50">
              Gunakan titik ini
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
