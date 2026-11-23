import { useEffect, useState } from 'react';
import { getKategoriDropdown } from '../services/kategoriService';
import { getUomDropdown } from '../services/uomService';
import { getVariantDropdown } from '../services/variantService';

/** Pilihan untuk form produk (endpoint /dropdown, cukup login): kategori, UoM, jenis varian. */
export default function useProdukOptions(token) {
  const [options, setOptions] = useState({ kategori: [], uom: [], variants: [] });

  useEffect(() => {
    Promise.all([getKategoriDropdown(token), getUomDropdown(token), getVariantDropdown(token)])
      .then(([kategori, uom, variants]) => setOptions({ kategori, uom, variants }))
      .catch((err) => console.error(err));
  }, [token]);

  return options;
}
