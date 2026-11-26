import {
  getCustomerDropdown, getCustomerReceipts, getCustomerReceipt, getCustomerOpenInvoices, createCustomerReceipt, cancelCustomerReceipt,
} from '../../services/salesService';
import {
  getVendorPaymentBatches, getVendorPaymentBatch, getVendorOpenBills, createVendorPaymentBatch, cancelVendorPaymentBatch,
} from '../../services/purchaseService';
import { getVendorDropdown } from '../../services/vendorService';

/**
 * Konfigurasi pembayaran gabungan (halaman PaymentBatchList / PaymentBatchDetail):
 *   customer : penerimaan dari customer untuk beberapa invoice penjualan (/customer-receipt, izin salesPayment)
 *   vendor   : pembayaran ke vendor untuk beberapa tagihan (/vendor-payment-batch, izin vendorPayment + vendorPrice)
 */
export const BATCH_KINDS = {
  customer: {
    title: 'Customer Receipt',
    newTitle: 'Receive Payment',
    subtitle: 'Satu penerimaan uang dari customer untuk beberapa invoice sekaligus.',
    basePath: '/customer-receipt',
    parentPath: '/sales-payment',
    resource: 'salesPayment',
    partyField: 'customer',
    partyLabel: 'Customer',
    partyName: (p) => p?.name || '',
    loadParties: async (token) => (await getCustomerDropdown(token)).filter((c) => !c.isWalkIn),
    list: getCustomerReceipts,
    listKey: 'dataCustomerReceipt',
    get: getCustomerReceipt,
    openInvoices: getCustomerOpenInvoices,
    create: createCustomerReceipt,
    cancel: cancelCustomerReceipt,
    invoiceField: 'salesInvoice',
    invoiceLabel: 'Invoice',
    invoicePath: '/sales-invoice',
    auditEntity: 'customerReceipt',
    printTitle: 'KUITANSI',
    printSubtitle: 'Bukti penerimaan pembayaran',
    partyHeading: 'Diterima dari',
  },
  vendor: {
    title: 'Vendor Payment Batch',
    newTitle: 'Pay Vendor Bills',
    subtitle: 'Satu pembayaran ke vendor untuk beberapa tagihan sekaligus.',
    basePath: '/vendor-payment-batch',
    parentPath: '/vendor-payment',
    resource: 'vendorPayment',
    partyField: 'vendor',
    partyLabel: 'Vendor',
    partyName: (p) => p?.companyName || '',
    loadParties: getVendorDropdown,
    list: getVendorPaymentBatches,
    listKey: 'dataVendorPaymentBatch',
    get: getVendorPaymentBatch,
    openInvoices: getVendorOpenBills,
    create: createVendorPaymentBatch,
    cancel: cancelVendorPaymentBatch,
    invoiceField: 'purchaseInvoice',
    invoiceLabel: 'Vendor bill',
    invoicePath: '/purchase-invoice',
    auditEntity: 'vendorPaymentBatch',
    printTitle: 'BUKTI PEMBAYARAN',
    printSubtitle: 'Pembayaran tagihan vendor',
    partyHeading: 'Dibayarkan kepada',
  },
};
