import {
  getCustomerDropdown, getCustomerDeposits, getCustomerDeposit, createCustomerDeposit, applyCustomerDeposit,
  refundCustomerDeposit, cancelCustomerDepositRefund, cancelCustomerDeposit, getCustomerOpenInvoices, getSalesOrders,
} from '../../services/salesService';
import {
  getVendorDeposits, getVendorDeposit, createVendorDeposit, applyVendorDeposit, refundVendorDeposit,
  cancelVendorDepositRefund, cancelVendorDeposit, getVendorOpenBills, getPurchaseOrders,
} from '../../services/purchaseService';
import { getVendorDropdown } from '../../services/vendorService';

/**
 * Konfigurasi deposit / uang muka (halaman DepositList / DepositDetail):
 *   customer : deposit customer (/customer-deposit, izin salesPayment)
 *   vendor   : uang muka ke vendor (/vendor-deposit, izin vendorPayment + vendorPrice)
 */
export const DEPOSIT_KINDS = {
  customer: {
    title: 'Customer Deposit',
    newTitle: 'New Deposit',
    subtitle: 'Uang muka & kelebihan bayar customer: dipakai untuk invoice berikutnya atau dikembalikan.',
    basePath: '/customer-deposit',
    resource: 'salesPayment',
    partyField: 'customer',
    partyLabel: 'Customer',
    partyName: (p) => p?.name || '',
    loadParties: async (token) => (await getCustomerDropdown(token)).filter((c) => !c.isWalkIn),
    list: getCustomerDeposits,
    listKey: 'dataCustomerDeposit',
    get: getCustomerDeposit,
    create: createCustomerDeposit,
    apply: applyCustomerDeposit,
    refund: refundCustomerDeposit,
    cancelRefund: cancelCustomerDepositRefund,
    cancel: cancelCustomerDeposit,
    openInvoices: getCustomerOpenInvoices,
    // pesanan aktif customer (uang muka untuk SO tsb, info saja)
    loadOrders: async (party, token) => (await getSalesOrders(token, { customer: party, status: 'ACTIVE', pageSize: 100 })).dataSalesOrder || [],
    orderField: 'salesOrder',
    orderLabel: 'Sales order',
    orderPath: '/sales-order',
    invoiceField: 'salesInvoice',
    invoiceLabel: 'Invoice',
    invoicePath: '/sales-invoice',
    batchPath: '/customer-receipt',
    auditEntity: 'customerDeposit',
    refundText: 'Uang dikembalikan ke customer',
  },
  vendor: {
    title: 'Vendor Deposit',
    newTitle: 'New Vendor Deposit',
    subtitle: 'Uang muka yang dibayar ke vendor: dipakai untuk tagihan berikutnya atau dikembalikan vendor.',
    basePath: '/vendor-deposit',
    resource: 'vendorPayment',
    partyField: 'vendor',
    partyLabel: 'Vendor',
    partyName: (p) => p?.companyName || '',
    loadParties: getVendorDropdown,
    list: getVendorDeposits,
    listKey: 'dataVendorDeposit',
    get: getVendorDeposit,
    create: createVendorDeposit,
    apply: applyVendorDeposit,
    refund: refundVendorDeposit,
    cancelRefund: cancelVendorDepositRefund,
    cancel: cancelVendorDeposit,
    openInvoices: getVendorOpenBills,
    loadOrders: async (party, token) => (await getPurchaseOrders(token, { vendor: party, status: 'ACTIVE', pageSize: 100 })).dataPurchaseOrder || [],
    orderField: 'purchaseOrder',
    orderLabel: 'Purchase order',
    orderPath: '/purchase-order',
    invoiceField: 'purchaseInvoice',
    invoiceLabel: 'Vendor bill',
    invoicePath: '/purchase-invoice',
    batchPath: '/vendor-payment-batch',
    auditEntity: 'vendorDeposit',
    refundText: 'Uang dikembalikan oleh vendor',
  },
};
