import { useId } from 'react';

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

/**
 * Responsif berdasarkan lebar container (container query Tailwind `@container`),
 * bukan lebar layar, karena lebar area konten juga dipengaruhi sidebar.
 *
 * Lebar (>= 672px) : Showing 1-5 of 23 records   Show [5] rows   « ‹ 1 2 3 4 5 › »
 * Sempit           : 1-5 of 23                                     Show [5]
 *                                « ‹  Page 2 / 5  › »
 */
export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  const pageSizeId = useId();

  if (totalItems === 0) return null;

  const totalPages = Math.ceil(totalItems / pageSize);
  const startRecord = (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalItems);
  const isFirst = currentPage === 1;
  const isLast = currentPage === totalPages;

  // maksimal 5 nomor halaman di sekitar halaman aktif
  let startPage = Math.max(currentPage - 2, 1);
  const endPage = Math.min(startPage + 4, totalPages);
  if (endPage - startPage < 4) {
    startPage = Math.max(endPage - 4, 1);
  }
  const pages = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  const navButton = `
    h-8 min-w-8 px-2 rounded border border-line
    flex items-center justify-center
    cursor-pointer hover:bg-subtle
    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`;

  return (
    <div className="@container mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm">
        {/* Info */}
        <div className="mr-auto text-muted">
          <span className="hidden @md:inline">Showing </span>
          <b>{startRecord}</b>–<b>{endRecord}</b> of <b>{totalItems}</b>
          <span className="hidden @md:inline"> records</span>
        </div>

        {/* Page size */}
        <div className="flex items-center gap-2">
          <label htmlFor={pageSizeId}>Show</label>
          <select
            id={pageSizeId}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="border border-line rounded px-2 py-1"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <span className="hidden @md:inline">rows</span>
        </div>

        {/* Navigation: baris sendiri (rata tengah) saat sempit, sebaris saat lebar */}
        <nav aria-label="Pagination" className="w-full @2xl:w-auto flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={isFirst}
            aria-label="First page"
            title="First page"
            className={navButton}
          >
            <i className="fa fa-angles-left text-xs"></i>
          </button>
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={isFirst}
            aria-label="Previous page"
            title="Previous page"
            className={navButton}
          >
            <i className="fa fa-angle-left text-xs"></i>
          </button>

          {/* nomor halaman hanya jika cukup ruang */}
          <div className="hidden @lg:flex items-center gap-1">
            {pages.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => onPageChange(page)}
                aria-label={`Page ${page}`}
                aria-current={currentPage === page ? 'page' : undefined}
                className={`h-8 min-w-8 px-2 rounded border cursor-pointer ${
                  currentPage === page
                    ? 'bg-primary border-primary text-primary-fg'
                    : 'border-line hover:bg-subtle'
                }`}
              >
                {page}
              </button>
            ))}
          </div>

          {/* pengganti nomor halaman saat sempit */}
          <span className="@lg:hidden px-3 text-fg whitespace-nowrap">
            Page <b>{currentPage}</b> / {totalPages}
          </span>

          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={isLast}
            aria-label="Next page"
            title="Next page"
            className={navButton}
          >
            <i className="fa fa-angle-right text-xs"></i>
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={isLast}
            aria-label="Last page"
            title="Last page"
            className={navButton}
          >
            <i className="fa fa-angles-right text-xs"></i>
          </button>
        </nav>
      </div>
    </div>
  );
}
