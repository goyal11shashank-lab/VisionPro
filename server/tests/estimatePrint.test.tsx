import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrintableVoucher } from '../../src/components/print/PrintableVoucher.js';
import { HalfSheetEstimate } from '../../src/components/print/HalfSheetEstimate.js';
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

// Batch allocation details are hidden from print output by default and only appear when explicitly enabled.
const batched: any = { ...voucher, lines: [{ ...voucher.lines[0], uniqueItemName: 'PC BCG SV -6/-2', quantity: 69, batches: [{ batchId: 'b1', sph: '-1.50', cyl: '0.00', quantity: 5 }, { batchId: 'b2', sph: '-2.00', cyl: '0.00', quantity: 5 }] }] };
for (const orientation of ['portrait', 'landscape'] as const) {
  const hidden = renderEstimatePages(batched, { orientation }).join('');
  assert.ok(!hidden.includes('SPH'), 'estimate print must hide batch powers by default');
  assert.ok(hidden.includes('69 PRS'), 'aggregate quantity stays on the grouped row');
  const shown = renderEstimatePages(batched, { orientation, showBatches: true }).join('');
  assert.ok(shown.includes('SPH') && shown.includes('-1.50'), 'explicit showBatches keeps allocation detail');
}
const brandedDefault = renderToStaticMarkup(<PrintableVoucher business={business} voucher={batched} documentType="SALES_INVOICE" />);
assert.ok(!brandedDefault.includes('SPH'), 'branded half-sheet hides batches by default');
assert.ok(brandedDefault.includes('PC BCG SV -6/-2'), 'grouped item row remains');
const brandedEnabled = renderToStaticMarkup(<HalfSheetEstimate voucher={batched} settings={{ print: { showBatchDetails: true } }} id="t-on" />);
assert.ok(brandedEnabled.includes('SPH') && brandedEnabled.includes('-1.50'), 'settings toggle re-enables batch details');
const brandedOff = renderToStaticMarkup(<HalfSheetEstimate voucher={batched} settings={{}} id="t-off" />);
assert.ok(!brandedOff.includes('SPH'), 'half-sheet without the toggle stays grouped');

// Invoice print polish: balance labels renamed, saved notes never printed on invoices, header band clears the first row.
const credited = estimateSummary({ ...voucher, partyName: 'Named Customer', printBalanceSnapshot: { previousBalance: 2385, balanceAfterBill: 2515 } });
assert.ok(credited.some(r => r.label === 'Previous Balance'), 'summary uses Previous Balance label');
assert.ok(credited.at(-1)?.label === 'Current Balance', 'summary uses Current Balance label');
assert.ok(!credited.some(r => r.label.includes('Ledger')), 'old Ledger labels retired');
const noted: any = { ...voucher, notes: 'INTERNAL packing note' };
const notedMarkup = renderToStaticMarkup(<HalfSheetEstimate voucher={noted} settings={{}} id="t-note" />);
assert.ok(!notedMarkup.includes('INTERNAL packing note'), 'invoice print never renders saved notes');
const portraitPage = renderEstimatePages(voucher, { orientation: 'portrait' }).join('');
assert.ok(portraitPage.includes('y="238"'), 'header band moved up (start-40)');
assert.ok(portraitPage.includes('x="25" y="288"'), 'first row baseline clears the header band');
console.log('PASS print-brand isolation, no input mutation, stored tax split, walk-in balance safety, date, full-name/giant-row pagination, escaping, other-business legacy layout, batch details hidden by default with opt-in, balance labels, notes off invoices, header clearance');
