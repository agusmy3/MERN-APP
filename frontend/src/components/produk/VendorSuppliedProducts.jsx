import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVendorPrices } from '../../services/vendorPriceService';
import usePermission from '../../hooks/usePermission';
import { formatRupiah, variantLabel } from '../../utils/formatHelper';

/**
 * Daftar produk yang disediakan vendor beserta harga belinya (baca saja), untuk drawer Vendor.
 * Hanya tampil jika user punya izin vendorPrice:view (harga beli = data sensitif).
 * Harga diubah dari tab "Vendor Prices" di halaman detail produk.
 */
export default function VendorSuppliedProducts({ vendorId, token }) {
  const { canView } = usePermission('vendorPrice');
  const [prices, setPrices] = useState(null);

  useEffect(() => {
    if (!canView || !vendorId) return;
    getVendorPrices(token, { vendor: vendorId })
      .then(setPrices)
      .catch((err) => {
        console.error(err);
        setPrices([]);
      });
  }, [canView, vendorId, token]);

  if (!canView) return null;

  return (
    <div>
      <div className="text-sm font-medium text-muted mb-1">
        Products Supplied {prices && `(${prices.length})`}
      </div>
      {prices === null && <p className="text-sm text-muted">Loading...</p>}
      {prices?.length === 0 && (
        <p className="text-sm text-muted rounded-md border border-line bg-subtle p-3">
          Belum ada harga produk dari vendor ini. Tambahkan dari tab Vendor Prices di halaman detail produk.
        </p>
      )}
      {prices?.length > 0 && (
        <ul className="rounded-md border border-line divide-y divide-line-soft max-h-72 overflow-auto">
          {prices.map((p) => (
            <li key={p._id} className="px-3 py-2 text-sm flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to={`/produk/${p.produk?._id}?tab=prices`}
                  className="font-medium text-fg hover:text-primary hover:underline"
                >
                  {p.produk?.name}
                </Link>
                {p.isPreferred && <i className="fa fa-star text-primary text-xs ml-1.5" title="Preferred vendor"></i>}
                <div className="text-xs text-muted truncate">
                  <span className="font-mono">{p.sku?.sku}</span> · {variantLabel(p.sku)}
                </div>
              </div>
              <div className="text-right shrink-0 tabular-nums">
                <div>{formatRupiah(p.hargaBeli)} / {p.uomBeli?.code}</div>
                <div className="text-xs text-muted">isi {p.konversi} · {formatRupiah(p.hargaPerUnit)}/unit</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
