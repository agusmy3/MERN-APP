import { formatDate2 } from '../utils/dateHelper';

/**
 * Sel tabel ringkas untuk audit log. Isi mengikuti sort yang aktif supaya urutan baris
 * sesuai dengan tanggal yang terlihat:
 * - sort createdDate -> tampilkan info created
 * - sort updatedDate -> tampilkan info updated ("Never updated" jika belum pernah)
 * - sort lain        -> perubahan terakhir (updated, atau created jika belum pernah diubah)
 * Detail lengkap tampil sebagai tooltip saat hover.
 */
export function AuditCell({ row, sortField }) {
  const isUpdated = !!row.updatedDate;
  const show = sortField === 'createdDate'
    ? 'created'
    : sortField === 'updatedDate' || isUpdated
      ? 'updated'
      : 'created';

  const tooltip = [
    `Created: ${formatDate2(row.createdDate)} by ${row.createdBy?.name || '-'}`,
    `Updated: ${isUpdated ? `${formatDate2(row.updatedDate)} by ${row.updatedBy?.name || '-'}` : '-'}`,
  ].join('\n');

  if (show === 'updated' && !isUpdated) {
    return (
      <div title={tooltip} className="truncate text-muted italic">Never updated</div>
    );
  }

  const date = show === 'updated' ? row.updatedDate : row.createdDate;
  const by = (show === 'updated' ? row.updatedBy?.name : row.createdBy?.name) || '-';

  return (
    // dipotong per baris agar lebar kolom tetap; detail lengkap ada di tooltip
    <div title={tooltip} className="min-w-0">
      <div className="truncate">{formatDate2(date)}</div>
      <div className="truncate text-xs text-muted">
        {show === 'updated' ? 'Updated' : 'Created'} by {by}
      </div>
    </div>
  );
}

/** Blok audit log lengkap, untuk ditampilkan di drawer saat edit. */
export function AuditDetail({ data }) {
  if (!data) return null;

  const rows = [
    ['Created', data.createdDate, data.createdBy?.name],
    ['Updated', data.updatedDate, data.updatedBy?.name],
  ];

  return (
    <div className="rounded border border-line bg-subtle p-3 text-xs text-muted">
      <div className="font-semibold text-fg mb-2">
        <i className="fa fa-clock-rotate-left"></i> Audit Log
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, date, by]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd>{date ? `${formatDate2(date)} · ${by || '-'}` : '-'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
