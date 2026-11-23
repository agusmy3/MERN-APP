import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getProduk,
  createProduk,
  updateProduk,
  deleteProduk
} from '../services/produkService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import useCrudDrawer from '../hooks/useCrudDrawer';
import useProdukOptions from '../hooks/useProdukOptions';
import DataPage from '../components/DataPage';
import FormDrawer from '../components/FormDrawer';
import ProdukFormFields from '../components/produk/ProdukFormFields';
import TruncateText from '../components/TruncateText';
import { AuditDetail } from '../components/AuditInfo';
import { auditColumn, actionColumn } from '../utils/tableColumns';
import { formatNumber, formatRupiahRange } from '../utils/formatHelper';
import { EMPTY_PRODUK_FORM, produkToForm } from '../utils/produkForm';

/**
 * Daftar produk (induk). SKU, harga jual, stok, dan harga vendor dikelola di halaman detail
 * /produk/:id. Drawer di sini hanya untuk info produk (tambah/ubah cepat).
 */
export default function Produk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const options = useProdukOptions(user.token);

  const fetchProduk = useCallback(async (params) => {
    const res = await getProduk(user.token, params);
    return { items: res.data.data.dataProduk, total: res.data.data.totalData };
  }, [user.token]);

  const table = useDataTable(fetchProduk);
  const openDetail = (row) => navigate(`/produk/${row._id}`);

  const crud = useCrudDrawer({
    entityName: 'Product',
    resource: 'produk',
    emptyForm: EMPTY_PRODUK_FORM,
    toForm: produkToForm,
    getLabel: (row) => row.name,
    create: (payload) => createProduk(payload, user.token),
    update: (id, payload) => updateProduk(id, payload, user.token),
    remove: (id) => deleteProduk(id, user.token),
    // produk baru -> langsung ke halaman detail untuk mengisi SKU & harga
    onSaved: (res, mode) => {
      if (mode === 'create' && res?.data?.data?._id) {
        navigate(`/produk/${res.data.data._id}?tab=sku`);
        return;
      }
      table.reload();
    },
    onDeleted: table.reloadAfterDelete,
  });

  const { editingRow, form } = crud;

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortField: 'name',
      width: 220,
      render: (p) => (
        <button
          type="button"
          onClick={() => openDetail(p)}
          className="block w-full text-left font-medium hover:text-primary hover:underline cursor-pointer min-w-0"
        >
          <TruncateText text={p.name} />
        </button>
      ),
    },
    { key: 'kategori', header: 'Category', width: 150, render: (p) => p.kategori?.name },
    { key: 'uom', header: 'UoM', width: 80, render: (p) => p.uom?.code },
    {
      key: 'variants',
      header: 'Variants',
      width: 150,
      render: (p) => (p.variants?.length ? p.variants.map((v) => v.code).join(', ') : <span className="text-muted italic">No variant</span>),
    },
    { key: 'skuCount', header: 'SKU', width: 70, className: 'text-right tabular-nums' },
    {
      key: 'harga',
      header: 'Selling Price',
      width: 200,
      className: 'text-right tabular-nums',
      render: (p) => formatRupiahRange(p.minHarga, p.maxHarga),
    },
    {
      key: 'stok',
      header: 'Stock',
      width: 100,
      className: 'text-right tabular-nums',
      render: (p) => `${formatNumber(p.totalStok)} ${p.uom?.code || ''}`,
    },
    auditColumn(table.sortField),
    actionColumn(crud, { onView: openDetail }),
  ];

  return (
    <DataPage
      fallbackTitle="Product"
      entityName="Product"
      onAdd={crud.addHandler}
      table={table}
      columns={columns}
      highlightKey={crud.highlightKey}
    >
      <FormDrawer {...crud.drawerProps}>
        <ProdukFormFields
          form={form}
          setForm={crud.setForm}
          onChange={crud.handleChange}
          options={options}
          variantsLocked={crud.mode === 'edit' && (editingRow?.skuCount || 0) > 0}
        />
        {crud.mode === 'create' && (
          <p className="text-xs text-muted">
            <i className="fa fa-circle-info mr-1"></i>
            Setelah disimpan, Anda diarahkan ke halaman detail untuk membuat SKU, harga jual, stok, dan harga vendor.
          </p>
        )}
        {editingRow && <AuditDetail data={editingRow} />}
      </FormDrawer>
    </DataPage>
  );
}
