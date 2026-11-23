import { isValidElement } from 'react';
import SortableTh from './SortableTh';
import SortMenuTh from './SortMenuTh';
import TruncateText from './TruncateText';

const NO_COLUMN_WIDTH = 56;
const DEFAULT_COLUMN_WIDTH = 160;

/**
 * Tabel generik dengan kolom No otomatis, lebar kolom tetap, dan tinggi header tetap.
 *
 * columns: [{
 *   key,              // unik, juga dipakai sebagai nama field jika tanpa render
 *   header,           // judul kolom
 *   width?,           // lebar kolom dalam px (default 160). Lebar tidak berubah mengikuti isi data.
 *   sortField?,       // isi agar kolom bisa di-sort dengan klik header (nama field di backend)
 *   sortOptions?,     // [{ field, label }] -> header jadi menu pilihan sort (butuh onSortSelect)
 *   render?: (row) => node,
 *   className?, headerClassName?
 * }]
 *
 * Isi sel berupa teks/angka otomatis dipotong dengan "…" dan bisa diklik untuk melihat teks lengkap.
 * Untuk render custom (JSX), gunakan <TruncateText> sendiri di bagian yang perlu dipotong.
 */
export default function DataTable({
  columns,
  data,
  rowKey = '_id',
  sortField,
  sortOrder,
  onSort,
  onSortSelect,
  startIndex = 0,
  loading = false,
  emptyText = 'No data',
  highlightKey = null,
}) {
  // lebar minimum tabel = jumlah lebar kolom; jika layar lebih lebar, sisa ruang dibagi proporsional
  const totalWidth = NO_COLUMN_WIDTH + columns.reduce((sum, col) => sum + (col.width || DEFAULT_COLUMN_WIDTH), 0);

  const renderCell = (col, row) => {
    const content = col.render ? col.render(row) : row[col.key];
    if (content === null || content === undefined || content === '') {
      return <span className="text-muted">-</span>;
    }
    if (typeof content === 'string' || typeof content === 'number') {
      return <TruncateText text={String(content)} />;
    }
    // JSX custom: tetap dijaga agar tidak melebarkan kolom
    return isValidElement(content) || Array.isArray(content)
      ? <div className="min-w-0 overflow-hidden">{content}</div>
      : content;
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
      <table
        className="w-full table-fixed bg-surface border-separate border-spacing-0"
        style={{ minWidth: totalWidth }}
      >
        <colgroup>
          <col style={{ width: NO_COLUMN_WIDTH }} />
          {columns.map((col) => (
            <col key={col.key} style={{ width: col.width || DEFAULT_COLUMN_WIDTH }} />
          ))}
        </colgroup>
        {/* header netral (bukan warna utama) supaya tombol Add tetap paling menonjol */}
        <thead className="bg-head text-head-fg text-left text-sm sticky top-0 z-10">
          <tr>
            <th className="h-11 px-2 py-0 border-b border-line font-semibold text-center whitespace-nowrap">No</th>
            {columns.map((col) => {
              if (col.sortOptions) {
                return (
                  <SortMenuTh
                    key={col.key}
                    label={col.header}
                    options={col.sortOptions}
                    sortField={sortField}
                    sortOrder={sortOrder}
                    onSelect={onSortSelect}
                    className={col.headerClassName}
                  />
                );
              }
              if (col.sortField) {
                return (
                  <SortableTh
                    key={col.key}
                    field={col.sortField}
                    label={col.header}
                    sortField={sortField}
                    sortOrder={sortOrder}
                    onSort={onSort}
                    className={col.headerClassName}
                  />
                );
              }
              return (
                <th key={col.key} className={`h-11 px-4 py-0 border-b border-line font-semibold whitespace-nowrap ${col.headerClassName || ''}`}>
                  <span className="block truncate">{col.header}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={`text-sm transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {data.map((row, index) => (
            <tr
              key={row[rowKey]}
              className={row[rowKey] === highlightKey ? 'bg-highlight' : 'hover:bg-subtle'}
            >
              <td className="px-2 py-2 border-t border-t-line-soft text-center text-muted tabular-nums">{startIndex + index + 1}</td>
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-2 border-t border-t-line-soft overflow-hidden ${col.className || ''}`}>
                  {renderCell(col, row)}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="text-center py-6 text-muted">
                {loading ? 'Loading...' : emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
