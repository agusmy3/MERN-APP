import { useCallback } from 'react';
import { searchPoItems } from '../../services/purchaseService';
import ItemCombobox, { SkuLabel } from '../ItemCombobox';
import { formatRupiah } from '../../utils/formatHelper';

const TABS = [
  { key: 'vendor', label: 'Item vendor ini', limit: 200, emptyText: 'Vendor ini belum punya daftar harga. Pakai tab "Semua SKU".' },
  { key: 'all', label: 'Semua SKU', requireQuery: true, limit: 30, emptyText: 'Ketik kode SKU atau nama produk untuk mencari semua SKU aktif.' },
];

const bestPrice = (item) => item.prices.find((p) => p.isPreferred) || item.prices[0];

/**
 * Tambah SKU ke baris PO + harga dari vendor terpilih.
 * Tab "Item vendor ini" = SKU yang punya harga dari vendor (bisa difilter), "Semua SKU" = cari semua SKU aktif.
 * SKU yang sudah ada tetap bisa dipilih lagi (satuan beli lain = baris baru).
 */
export default function PoItemPicker({ token, vendor, existing, onAdd }) {
  const fetchItems = useCallback(
    ({ query, tab }) => searchPoItems(token, { vendor, search: query, scope: tab }),
    [token, vendor],
  );

  return (
    <ItemCombobox
      key={vendor || 'none'}
      label="Tambah item..."
      disabled={!vendor}
      disabledText="Pilih vendor dulu"
      tabs={TABS}
      fetchItems={fetchItems}
      renderItem={(item) => <SkuLabel item={item} />}
      renderMeta={(item) => {
        const price = bestPrice(item);
        return price
          ? <>{formatRupiah(price.hargaBeli)} / {price.uomBeli?.code}{item.prices.length > 1 && <span className="text-muted"> (+{item.prices.length - 1})</span>}</>
          : <span className="text-muted">no vendor price</span>;
      }}
      isAdded={(item) => !!existing?.has(item._id)}
      addedSelectable
      onPick={onAdd}
    />
  );
}
