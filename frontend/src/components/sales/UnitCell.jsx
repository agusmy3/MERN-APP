import { selectableUnits } from '../../utils/salesLines';
import { formatNumber } from '../../utils/formatHelper';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;

/**
 * Sel satuan jual baris dokumen: select (satuan dasar + kemasan aktif yang belum dipakai baris lain SKU sama)
 * saat bisa diedit, selain itu teks "DUS · isi 24". onChange(uomId).
 */
export default function UnitCell({ line, lines, editable, disabled, onChange }) {
  const options = editable ? selectableUnits(line, lines) : [];
  const k = line.konversi || 1;
  if (!editable || options.length <= 1) {
    return (
      <span className="text-sm">
        {line.uomCode || line.baseCode}
        {k > 1 && <span className="block text-[10px] text-muted">isi {formatNumber(k)} {line.baseCode}</span>}
      </span>
    );
  }
  return (
    <select aria-label={`Unit ${line.sku.sku}`} value={line.uomId || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${cellInput} px-1`}>
      {options.map((u) => (
        <option key={u.uom?._id || 'base'} value={u.uom?._id || ''}>
          {u.uom?.code}{u.konversi > 1 ? ` (${formatNumber(u.konversi)})` : ''}
        </option>
      ))}
    </select>
  );
}
