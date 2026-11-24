import { useState } from 'react';

/**
 * Grafik ringan tanpa library (SVG/CSS) memakai token tema aplikasi.
 * - Satu seri = satu warna (primary), tanpa kotak legenda (judul kartu menamainya).
 * - Hover: setiap batang menampilkan nilainya (readout di atas grafik + <title> bawaan browser).
 * - Setiap grafik punya tabel data (<details>) untuk aksesibilitas.
 */

function DataTable({ rows, columns }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted hover:text-fg">Data table</summary>
      <table className="mt-1 w-full">
        <thead>
          <tr>{columns.map((c) => <th key={c.label} className={`py-0.5 font-medium text-muted ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line-soft">
              {columns.map((c) => <td key={c.label} className={`py-0.5 ${c.right ? 'text-right tabular-nums' : ''}`}>{c.get(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Batang horizontal (besaran per kategori), diurutkan dari pemanggil.
 * items: [{ key, label, value, sub? }]
 */
export function BarList({ items, format, empty = 'No data' }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (!items.length || max <= 0) return <p className="text-sm text-muted py-6 text-center">{empty}</p>;
  return (
    <>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.key} className="group" title={`${i.label}: ${format(i.value)}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-fg">{i.label}{i.sub && <span className="text-muted"> · {i.sub}</span>}</span>
              <span className="tabular-nums text-fg font-medium shrink-0">{format(i.value)}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-subtle overflow-hidden">
              <div className="h-full rounded bg-primary group-hover:bg-primary-hover transition-colors" style={{ width: `${Math.max((i.value / max) * 100, 1)}%` }}></div>
            </div>
          </li>
        ))}
      </ul>
      <DataTable rows={items} columns={[{ label: 'Item', get: (r) => r.label }, { label: 'Value', right: true, get: (r) => format(r.value) }]} />
    </>
  );
}

const W = 600; // lebar viewBox; tinggi mengikuti prop
const PAD = { top: 8, bottom: 22, left: 4, right: 4 };

/**
 * Kolom vertikal satu seri (mis. pembelian per bulan).
 * points: [{ key, label, value }]
 */
export function ColumnChart({ points, format, height = 180, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  const barW = Math.min(slot - 2, 48); // celah >= 2px antar batang
  const y = (v) => PAD.top + plotH - (max > 0 ? (v / max) * plotH : 0);
  const shown = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="h-5 text-xs text-muted tabular-nums" aria-live="polite">
        {shown ? <><b className="text-fg">{shown.label}</b>: {format(shown.value)}</> : `Max ${format(max)}`}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="stroke-line" strokeWidth="1" />
        {points.map((p, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const h = Math.max(y(0) - y(p.value), p.value > 0 ? 2 : 0);
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)}>
              {/* area hover lebih besar dari batang */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} className="fill-transparent" />
              <rect x={cx - barW / 2} y={y(0) - h} width={barW} height={h} rx="4"
                className={hover === i ? 'fill-primary-hover' : 'fill-primary'}>
                <title>{`${p.label}: ${format(p.value)}`}</title>
              </rect>
              <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">{p.label}</text>
            </g>
          );
        })}
      </svg>
      <DataTable rows={points} columns={[{ label: 'Period', get: (r) => r.label }, { label: 'Value', right: true, get: (r) => format(r.value) }]} />
    </div>
  );
}

/**
 * Masuk vs keluar per hari: batang cermin (masuk di atas garis dasar, keluar di bawah).
 * Identitas dari posisi + legenda, bukan warna saja. points: [{ key, label, in, out }]
 */
export function InOutChart({ points, format, height = 200, ariaLabel, labelEvery = 5 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...points.flatMap((p) => [p.in, p.out]), 0);
  const plotH = height - PAD.top - PAD.bottom;
  const mid = PAD.top + plotH / 2;
  const half = plotH / 2;
  const slot = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  const barW = Math.max(Math.min(slot - 2, 16), 2);
  const h = (v) => (max > 0 && v > 0 ? Math.max((v / max) * (half - 2), 2) : 0);
  const shown = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 h-5 text-xs text-muted tabular-nums">
        <span aria-live="polite">
          {shown ? <><b className="text-fg">{shown.label}</b>: in {format(shown.in)} · out {format(shown.out)}</> : 'Hover a day for details'}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary"></span>In (above)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary/40"></span>Out (below)</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <line x1={PAD.left} x2={W - PAD.right} y1={mid} y2={mid} className="stroke-line" strokeWidth="1" />
        {points.map((p, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const active = hover === i;
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} className={active ? 'fill-subtle' : 'fill-transparent'} />
              {p.in > 0 && <rect x={cx - barW / 2} y={mid - 1 - h(p.in)} width={barW} height={h(p.in)} rx="2" className="fill-primary" />}
              {p.out > 0 && <rect x={cx - barW / 2} y={mid + 1} width={barW} height={h(p.out)} rx="2" className="fill-primary/40" />}
              <title>{`${p.label}: in ${format(p.in)}, out ${format(p.out)}`}</title>
              {(i % labelEvery === 0 || i === points.length - 1) && (
                <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <DataTable rows={points} columns={[
        { label: 'Day', get: (r) => r.label },
        { label: 'In', right: true, get: (r) => format(r.in) },
        { label: 'Out', right: true, get: (r) => format(r.out) },
      ]} />
    </div>
  );
}
