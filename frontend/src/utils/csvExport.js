/** Nilai 1 sel CSV (dikutip bila mengandung koma, kutip, titik koma, atau baris baru) */
export const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Unduh CSV (UTF-8 dengan BOM supaya Excel membaca karakter dengan benar). rows = array of array */
export const downloadCsv = (filename, rows) => {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
