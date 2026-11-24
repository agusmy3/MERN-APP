import { useCallback } from 'react';
import { searchStockSkus } from '../../services/stockService';
import ItemCombobox, { SkuLabel } from '../ItemCombobox';
import { formatNumber } from '../../utils/formatHelper';

/**
 * Tambah SKU lintas produk (cari kode SKU / nama produk) ke baris dokumen stok.
 * `existing` = Set id SKU yang sudah ada di dokumen (ditandai "added", tidak bisa ditambah lagi).
 * `searchFn(token, params)` = endpoint pencarian (default: Stock Adjustment), hasil berbentuk sama.
 */
export default function SkuPicker({ token, gudang, existing, onAdd, searchFn = searchStockSkus }) {
  const fetchItems = useCallback(({ query }) => searchFn(token, { search: query, gudang }), [token, gudang, searchFn]);

  return (
    <ItemCombobox
      label="Tambah SKU..."
      requireQuery
      emptyText="Ketik kode SKU atau nama produk untuk mencari."
      limit={20}
      fetchItems={fetchItems}
      renderItem={(s) => <SkuLabel item={s} />}
      renderMeta={(s, added) => !added && <span className="text-muted">{formatNumber(s.qty)} {s.uom}</span>}
      isAdded={(s) => existing.has(s._id)}
      onPick={(s) => onAdd([s])}
      className="flex-1 min-w-56 max-w-lg"
    />
  );
}
