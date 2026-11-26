import FormField from './FormField';
import { inputClass } from '../utils/formStyles';
import { mapUrl } from '../utils/regionMeta';

/**
 * Provinsi, kota / kabupaten, kecamatan, kode pos & koordinat (Customer, Vendor). Alamat jalan ada di field
 * masing-masing form. `setForm` = setter state form (updater function).
 */
export default function RegionFields({ form, setForm, idPrefix }) {
  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));
  const validCoord = form.latitude && form.longitude && !Number.isNaN(Number(form.latitude)) && !Number.isNaN(Number(form.longitude));
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Province" htmlFor={`${idPrefix}-provinsi`}>
          <input id={`${idPrefix}-provinsi`} autoComplete="off" placeholder="e.g. DKI Jakarta" maxLength={120}
            value={form.provinsi} onChange={(e) => set('provinsi', e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="City / Regency" htmlFor={`${idPrefix}-kota`}>
          <input id={`${idPrefix}-kota`} autoComplete="off" placeholder="e.g. Jakarta Selatan" maxLength={120}
            value={form.kota} onChange={(e) => set('kota', e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="District" htmlFor={`${idPrefix}-kecamatan`}>
          <input id={`${idPrefix}-kecamatan`} autoComplete="off" placeholder="Kecamatan" maxLength={120}
            value={form.kecamatan} onChange={(e) => set('kecamatan', e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="Postal Code" htmlFor={`${idPrefix}-kodepos`} hint="5 digit.">
          <input id={`${idPrefix}-kodepos`} autoComplete="off" inputMode="numeric" maxLength={5} placeholder="12345"
            value={form.kodePos} onChange={(e) => set('kodePos', e.target.value.replace(/\D/g, '').slice(0, 5))} className={inputClass} />
        </FormField>
      </div>
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
    </>
  );
}
