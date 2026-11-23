import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getProdukById,
  getProdukSkus,
  updateProduk,
  deleteProduk
} from '../services/produkService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useCrudDrawer from '../hooks/useCrudDrawer';
import useConfirm from '../hooks/useConfirm';
import useToast from '../hooks/useToast';
import useProdukOptions from '../hooks/useProdukOptions';
import PageHeader from '../components/PageHeader';
import FormDrawer from '../components/FormDrawer';
import ProdukFormFields from '../components/produk/ProdukFormFields';
import ProdukSkuTab from '../components/produk/ProdukSkuTab';
import VendorPriceTab from '../components/produk/VendorPriceTab';
import ProdukStockTab from '../components/produk/ProdukStockTab';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { EMPTY_PRODUK_FORM, produkToForm } from '../utils/produkForm';
import { formatNumber, formatRupiahRange } from '../utils/formatHelper';

function InfoItem({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 text-fg break-words">{children || <span className="text-muted">-</span>}</dd>
    </div>
  );
}

function InfoTab({ produk }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="rounded-lg border border-line bg-surface p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <InfoItem label="Name">{produk.name}</InfoItem>
          <InfoItem label="Category">{produk.kategori?.name}</InfoItem>
          <InfoItem label="Base UoM">{produk.uom && `${produk.uom.code} — ${produk.uom.name}`}</InfoItem>
          <InfoItem label="Variant Types">
            {produk.variants?.length ? (
              <div className="space-y-1">
                {produk.variants.map((v) => (
                  <div key={v._id} className="text-sm">
                    <b>{v.name}</b> <span className="text-muted">({v.values.join(', ')})</span>
                  </div>
                ))}
              </div>
            ) : <span className="text-muted italic">No variant</span>}
          </InfoItem>
          <div className="sm:col-span-2">
            <InfoItem label="Description">{produk.deskripsi}</InfoItem>
          </div>
        </dl>
      </section>

      <div className="space-y-4">
        <section className="rounded-lg border border-line bg-surface p-4">
          <dl className="grid grid-cols-2 gap-4">
            <InfoItem label="SKU">{formatNumber(produk.skuCount)}</InfoItem>
            <InfoItem label="Total Stock">{`${formatNumber(produk.totalStok)} ${produk.uom?.code || ''}`}</InfoItem>
            <div className="col-span-2">
              <InfoItem label="Selling Price">{formatRupiahRange(produk.minHarga, produk.maxHarga)}</InfoItem>
            </div>
          </dl>
        </section>
        <AuditDetail data={produk} />
      </div>
    </div>
  );
}

/**
 * Detail produk: /produk/:id?tab=info|sku|stock|prices|history
 * Info (ringkasan) · Variants & SKU (harga jual) · Stock (saldo per gudang & kartu stok, izin stockMovement)
 * · Vendor Prices (harga beli, butuh izin vendorPrice) · History
 */
export default function ProdukDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const perm = usePermission('produk');
  const pricePerm = usePermission('vendorPrice');
  const stockPerm = usePermission('stockMovement');
  const adjustPerm = usePermission('stockAdjustment');
  const confirm = useConfirm();
  const toast = useToast();
  const options = useProdukOptions(user.token);

  const [produk, setProduk] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [skuData, setSkuData] = useState({ skus: [], canSeeCost: false });
  // berubah setiap data dimuat ulang -> tab History ikut menyegarkan
  const [version, setVersion] = useState(0);

  const loadProduk = useCallback(async () => {
    try {
      setProduk(await getProdukById(id, user.token));
    } catch (err) {
      if ([400, 404].includes(err.response?.status)) setNotFound(true);
      else console.error(err);
    }
  }, [id, user.token]);

  const loadSkus = useCallback(async () => {
    try {
      setSkuData(await getProdukSkus(id, user.token));
    } catch (err) {
      console.error(err);
    }
  }, [id, user.token]);

  useEffect(() => {
    loadProduk();
    loadSkus();
  }, [loadProduk, loadSkus]);

  const reloadAll = () => {
    loadProduk();
    loadSkus();
    setVersion((v) => v + 1);
  };

  // edit info produk lewat drawer yang sama dengan halaman daftar
  const crud = useCrudDrawer({
    entityName: 'Product',
    resource: 'produk',
    emptyForm: EMPTY_PRODUK_FORM,
    toForm: produkToForm,
    getLabel: (row) => row.name,
    update: (productId, payload) => updateProduk(productId, payload, user.token),
    onSaved: reloadAll,
  });

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete product?',
      message: `"${produk.name}" beserta ${produk.skuCount} SKU dan semua harga vendornya akan dihapus permanen. `
        + 'Produk yang SKU-nya sudah punya histori stok tidak bisa dihapus (nonaktifkan SKU-nya).',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await deleteProduk(produk._id, user.token);
      toast.success(res.data.message);
      navigate('/produk');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete product');
    }
  };

  const tabs = [
    { key: 'info', label: 'Info', icon: 'fa-circle-info' },
    { key: 'sku', label: `Variants & SKU (${skuData.skus.length})`, icon: 'fa-layer-group' },
    ...(stockPerm.canView ? [{ key: 'stock', label: 'Stock', icon: 'fa-boxes-stacked' }] : []),
    ...(pricePerm.canView ? [{ key: 'prices', label: 'Vendor Prices', icon: 'fa-truck' }] : []),
    { key: 'history', label: 'History', icon: 'fa-clock-rotate-left' },
  ];
  // filter tab History: harga vendor hanya untuk yang boleh melihat harga beli
  const historyScopes = [
    { key: 'info', label: 'Info' },
    { key: 'sku', label: 'SKU' },
    ...(pricePerm.canView ? [{ key: 'prices', label: 'Vendor Prices' }] : []),
  ];
  const activeTab = tabs.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'info';
  const selectTab = (key) => setSearchParams(key === 'info' ? {} : { tab: key }, { replace: true });

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Product not found</p>
        <p className="text-muted mb-6">Produk mungkin sudah dihapus.</p>
        <Link to="/produk" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Products
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Product"
        parentPath="/produk"
        title={produk?.name}
        subtitle={produk && [produk.kategori?.name, produk.uom?.code].filter(Boolean).join(' · ')}
        actions={produk && (
          <>
            {perm.canUpdate && (
              <button
                type="button"
                onClick={() => crud.openEdit(produk)}
                className="px-4 py-2 rounded-md border border-line hover:bg-subtle text-sm cursor-pointer"
              >
                <i className="fa fa-pen"></i> Edit
              </button>
            )}
            {perm.canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 rounded-md border border-danger-line text-danger hover:bg-danger-soft text-sm cursor-pointer"
              >
                <i className="fa fa-trash"></i> Delete
              </button>
            )}
          </>
        )}
      />

      {!produk ? (
        <div className="p-6 text-muted">Loading...</div>
      ) : (
        <>
          <div role="tablist" aria-label="Product sections" className="flex gap-1 border-b border-line mb-4 overflow-x-auto shrink-0">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                onClick={() => selectTab(t.key)}
                className={`px-4 py-2 -mb-px border-b-2 text-sm whitespace-nowrap cursor-pointer
                  ${activeTab === t.key
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-muted hover:text-fg'}`}
              >
                <i className={`fa ${t.icon} mr-1.5`}></i>{t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {activeTab === 'info' && <InfoTab produk={produk} />}
            {activeTab === 'sku' && (
              <ProdukSkuTab
                produk={produk}
                skuData={skuData}
                canUpdate={perm.canUpdate}
                canViewStock={stockPerm.canView}
                token={user.token}
                onChanged={reloadAll}
              />
            )}
            {activeTab === 'stock' && (
              <ProdukStockTab
                produk={produk}
                skus={skuData.skus}
                token={user.token}
                canAdjust={adjustPerm.canCreate}
                refreshKey={version}
              />
            )}
            {activeTab === 'prices' && (
              <VendorPriceTab
                produk={produk}
                skus={skuData.skus}
                token={user.token}
                onChanged={() => {
                  loadSkus();
                  setVersion((v) => v + 1);
                }}
              />
            )}
            {activeTab === 'history' && (
              <section className="rounded-lg border border-line bg-surface p-4 max-w-4xl">
                <AuditTimeline entity="produk" id={produk._id} scopes={historyScopes} refreshKey={version} />
              </section>
            )}
          </div>
        </>
      )}

      <FormDrawer {...crud.drawerProps}>
        <ProdukFormFields
          form={crud.form}
          setForm={crud.setForm}
          onChange={crud.handleChange}
          options={options}
          variantsLocked={skuData.skus.length > 0}
        />
        {crud.editingRow && <AuditDetail data={crud.editingRow} />}
      </FormDrawer>
    </div>
  );
}
