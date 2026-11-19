import { localDateInput } from '../../src/utils/localDateInput.js';
import assert from 'node:assert/strict';
import { normalizePaymentVoucher,normalizeUnpaidInvoices } from '../../src/utils/paymentResponse.js';
import { normalizeReportResponse,isCurrencySummaryKey } from '../../src/utils/reportResponse.js';
const invoices=[{id:'i',documentNumber:'INV-1',documentDate:'2026-11-20',grandTotal:130,paidAmount:0,outstandingAmount:130}];
assert.equal(normalizeUnpaidInvoices(invoices)[0].invoiceNumber,'INV-1');
assert.equal(normalizeUnpaidInvoices({unpaidInvoices:invoices})[0].invoiceDate,'2026-11-20');
assert.throws(()=>normalizeUnpaidInvoices({bad:true}));
const voucher=normalizePaymentVoucher({party_id:'p',payment_number:'REC-1',payment_date:'2026-11-20',allocations:[{document_id:'i',document_number:'INV-1',document_date:'2026-11-20',allocated_amount:'130.00'}]});
assert.equal(voucher.partyId,'p');assert.equal(voucher.paymentNumber,'REC-1');assert.equal(voucher.allocations[0].documentId,'i');assert.equal(voucher.allocations[0].allocatedAmount,130);
const report=normalizeReportResponse({data:[{invoiceNumber:'INV-1',invoiceDate:'2026-11-20',partyName:'Cash',grandTotal:130,igst:0}],pagination:{totalItems:1}},'sales');
assert.equal(report.data[0].invoice_number,'INV-1');assert.equal(report.data[0].customer_name,'Cash');assert.equal(report.data[0].grand_total,130);assert.equal(report.data[0].igst_amount,0);assert.equal(report.pagination.total,1);
for(const k of ['totalInvoices','totalPayments','totalRecords','totalQtyIn','totalQtyOut','physicalStock']) assert.equal(isCurrencySummaryKey(k),false,k);
for(const k of ['discountTotal','grandTotal','totalSupplierPayments','totalReceipts','igst','stockValue']) assert.equal(isCurrencySummaryKey(k),true,k);
console.log('Payment/report response contract checks PASS');

assert.equal(localDateInput(new Date('2026-11-20T00:15:00+05:30')), '2026-11-20');
