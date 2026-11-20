import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrintableVoucher } from '../../src/components/print/PrintableVoucher.js';
import { renderEstimatePages, estimateSummary } from '../../src/utils/estimatePrint.js';
import { printBusinessView } from '../../src/utils/printBranding.js';

const business: any = { id: 'c43b93ef-8569-4857-80ff-faca53b4ed7c', name: 'Lumina Opticals Pvt Ltd', city: 'Mumbai' };
const baseline = JSON.stringify(business);
assert.equal(printBusinessView(business)?.name, 'Optical Shop');
assert.equal(JSON.stringify(business), baseline);
const dealer: any = { id: 'different-dealer', name: 'Dealer Optical', city: 'Pune' };
assert.equal(printBusinessView(dealer), dealer);
const voucher: any = { invoiceNumber: 'LOCAL SAMPLE', invoiceDate: '2026-11-17T18:30:00.000Z', partyName: 'Cash', grandTotal: 130, subtotal: 130, lines: [{ id: 'a', uniqueItemName: 'FULL ITEM NAME', quantity: 1, rate: 130, lineTotal: 130, hsnCode: '9001', discountAmount: 0 }] };
for (const orientation of ['portrait', 'landscape'] as const) {
  const [page] = renderEstimatePages(voucher, { orientation });
  assert.ok(page.includes('ESTIMATE'));assert.ok(page.includes('18 Nov 2026'));
  assert.ok(!page.includes('GST'));assert.ok(page.includes('130.00'));
  const long = { ...voucher, partyName: 'Sample credit', lines: Array.from({ length: 80 }, (_, i) => ({ ...voucher.lines[0], uniqueItemName: `FULL long wrapped optical item ${i} ${'progressive '.repeat(12)}END${i}` })) };
  const pages = renderEstimatePages(long, { orientation });
  for (let i = 0; i < 80; i++) assert.ok(pages.join('').includes(`END${i}`));
  assert.ok(pages.length > 1);
  const giant = renderEstimatePages({ ...voucher, lines: [{ ...voucher.lines[0], uniqueItemName: 'X'.repeat(10000) }] }, { orientation });
  assert.ok(giant.length > 1);
  assert.equal((giant.join('').match(/1 PRS/g) || []).length, 1, 'Continuation must not repeat commercial quantity');
}
const taxed = { ...voucher, cgstAmount: 3.24, sgstAmount: 3.26, grandTotal: 136.50 };
const taxPage = renderEstimatePages(taxed)[0];
assert.ok(taxPage.includes('TAX INVOICE'));assert.ok(taxPage.includes('3.24'));assert.ok(taxPage.includes('3.26'));
const cash = { ...voucher, printBalanceSnapshot: { previousBalance: 2385, balanceAfterBill: 2515 } };
assert.equal(estimateSummary(cash).some(r => r.label.includes('Ledger')), false);
assert.equal(estimateSummary({ ...cash, partyName: 'Named Customer' }).at(-1)?.amount, 2515);
const escaped = renderEstimatePages({ ...voucher, partyName: '<script>unsafe</script>' })[0];
assert.ok(!escaped.includes('<script>'));assert.ok(escaped.includes('&lt;script&gt;'));
const generic = renderToStaticMarkup(<PrintableVoucher business={dealer} voucher={voucher} />);
assert.ok(generic.includes('Dealer Optical'));assert.ok(generic.includes('HSN / SAC'));assert.ok(generic.includes('Discount (₹)'));
assert.ok(!generic.includes('Optical Shop'));
console.log('PASS print-brand isolation, no input mutation, stored tax split, walk-in balance safety, date, full-name/giant-row pagination, escaping, other-business legacy layout');
