import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State tabel server-side: search (debounce), paginasi, sort, dan data.
 *
 * `fetcher(params)` menerima { search, page, pageSize, sortField, sortOrder }
 * dan harus mengembalikan { items, total }. Bungkus dengan useCallback
 * (mis. dependensi [user.token]) supaya tidak memicu fetch berulang.
 */
export default function useDataTable(fetcher, {
  defaultSortField = 'createdDate',
  defaultSortOrder = 'desc',
  defaultPageSize = 5,
  debounceMs = 500,
} = {}) {
  const [items, setItems] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [sortField, setSortField] = useState(defaultSortField);
  const [sortOrder, setSortOrder] = useState(defaultSortOrder);

  // abaikan response lama jika user sudah memicu request baru (mis. mengetik cepat)
  const latestRequest = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setCurrentPage(1);
    }, debounceMs);
    return () => clearTimeout(timeout);
  }, [searchInput, debounceMs]);

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    try {
      const { items, total } = await fetcher({
        search,
        page: currentPage,
        pageSize,
        sortField,
        sortOrder,
      });
      if (requestId === latestRequest.current) {
        setItems(items || []);
        setTotalItems(total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [fetcher, search, currentPage, pageSize, sortField, sortOrder]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // pilih field + arah sort secara eksplisit (dipakai menu sort, mis. kolom audit)
  const setSort = (field, order) => {
    setSortField(field);
    setSortOrder(order);
  };

  const setPageSize = (size) => {
    setPageSizeState(size);
    setCurrentPage(1);
  };

  // setelah hapus: mundur satu halaman jika item terakhir di halaman ini yang dihapus
  const reloadAfterDelete = () => {
    if (items.length === 1 && currentPage > 1) {
      setCurrentPage(currentPage - 1);
    } else {
      reload();
    }
  };

  return {
    items,
    totalItems,
    loading,
    searchInput,
    setSearchInput,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    sortField,
    sortOrder,
    toggleSort,
    setSort,
    reload,
    reloadAfterDelete,
    startIndex: (currentPage - 1) * pageSize,
  };
}
