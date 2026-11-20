import assert from 'node:assert/strict';
import { applyScannedBatch } from '../../src/lib/voucherBarcodeScan.js';
import { createEmptyVoucherLine } from '../../src/components/voucher/VoucherTypes.js';

const itemA = { id: 'A', name: 'Lens A', code: 'LA', maintainBatches: true, gstRate: '12', mrp: '100' };
const itemB = { id: 'B', name: 'Lens B', code: 'LB', maintainBatches: true };
const b = (id: string, sph: string, barcode: string) => ({ id, sph, cyl: '0.00', axis: '', add: '', side: 'NONE', barcode });
const hit = (item: any, batch: any, avail: number) => ({ uniqueItem: item, batch, stock: { availableStock: String(avail) } });
let lines = [createEmptyVoucherLine('row')];

// First scan fills the blank row, keeps one trailing blank row.
let r = applyScannedBatch(lines, hit(itemA, b('a1', '-1.00', 'X1'), 5), 100);
assert.ok(r.ok); lines = r.lines;
assert.equal(lines.length, 2); assert.equal(lines[0].uniqueItemId, 'A'); assert.equal(lines[0].quantity, 1); assert.equal(lines[1].uniqueItemId, '');
assert.equal(lines[0].rate, 100); assert.equal(lines[0].gstRate, 12);

// Same barcode again: same line, same power, quantity 2.
r = applyScannedBatch(lines, hit(itemA, b('a1', '-1.00', 'X1'), 5), 100); lines = r.lines;
assert.equal(lines.length, 2); assert.equal(lines[0].batches[0].quantity, 2); assert.equal(lines[0].quantity, 2);

// Same item, other power: second allocation on the same line.
r = applyScannedBatch(lines, hit(itemA, b('a2', '-1.50', 'X2'), 5), 100); lines = r.lines;
assert.equal(lines.length, 2); assert.equal(lines[0].batches.length, 2); assert.equal(lines[0].quantity, 3);

// Different item mixed in: its own new line, no item selection needed.
r = applyScannedBatch(lines, hit(itemB, b('b1', '+2.00', 'Y1'), 3), 250); lines = r.lines;
assert.equal(lines.length, 3); assert.equal(lines[1].uniqueItemId, 'B'); assert.equal(lines[1].rate, 250); assert.equal(lines[2].uniqueItemId, '');

// Back to item A: still the same A line (mixed order works).
r = applyScannedBatch(lines, hit(itemA, b('a1', '-1.00', 'X1'), 5), 100); lines = r.lines;
assert.equal(lines.filter(l => l.uniqueItemId === 'A').length, 1); assert.equal(lines[0].quantity, 4);

// Stock limit: B power has 3 available, scanning past it is refused and lines are unchanged.
for (let i = 0; i < 2; i++) { r = applyScannedBatch(lines, hit(itemB, b('b1', '+2.00', 'Y1'), 3), 250); assert.ok(r.ok); lines = r.lines; }
const before = lines;
r = applyScannedBatch(lines, hit(itemB, b('b1', '+2.00', 'Y1'), 3), 250);
assert.equal(r.ok, false); assert.equal(r.lines, before); assert.match(r.message, /only 3 available/);
// Zero stock new item refused; allowOverStock (editing a saved voucher) allows.
assert.equal(applyScannedBatch(lines, hit({ id: 'C', name: 'C' }, b('c1', '0', 'Z'), 0), 1).ok, false);
// Editing a saved voucher: limit is current stock + that voucher's own original qty for the power, no blanket bypass.
const orig = (id: string) => (id === 'c1' ? 2 : 0);
let e = applyScannedBatch(lines, hit({ id: 'C', name: 'C' }, b('c1', '0', 'Z'), 0), 1, { originalQty: orig }); // 0 + 2 original
assert.equal(e.ok, true);
e = applyScannedBatch(e.lines, hit({ id: 'C', name: 'C' }, b('c1', '0', 'Z'), 0), 1, { originalQty: orig });
assert.equal(e.ok, true); // second unit = original 2
const e3 = applyScannedBatch(e.lines, hit({ id: 'C', name: 'C' }, b('c1', '0', 'Z'), 0), 1, { originalQty: orig });
assert.equal(e3.ok, false); // third unit exceeds stock 0 + original 2
assert.equal(applyScannedBatch(lines, hit({ id: 'D', name: 'D' }, b('d1', '0', 'W'), 0), 1, { originalQty: orig }).ok, false); // new power not in original
// Purchase: incoming stock, no limit; rate carried on the allocation.
const pr = applyScannedBatch([createEmptyVoucherLine('row')], hit({ id: 'P', name: 'P' }, b('p1', '1', 'Q'), 0), 77, { purchase: true });
assert.ok(pr.ok); assert.equal(pr.lines[0].batches[0].rate, 77); assert.equal(pr.lines[0].quantity, 1);
// Missing item or batch.
assert.equal(applyScannedBatch(lines, { batch: undefined, uniqueItem: undefined }, 1).ok, false);
// Input lines are never mutated.
assert.equal(before[0].quantity, 4);

// Speed: 500 scans of mixed items apply in well under a second.
let big = [createEmptyVoucherLine('row')]; const t0 = Date.now();
for (let i = 0; i < 500; i++) { const it = { id: 'I' + (i % 40), name: 'Item' + (i % 40) }; big = applyScannedBatch(big, hit(it, b('B' + (i % 90), String(i % 9), 'K' + i), 9999), 1).lines; }
const ms = Date.now() - t0;
assert.ok(ms < 1000, `500 scans took ${ms}ms`);
console.log(`voucherBarcodeScan PASS (500 scans applied in ${ms}ms)`);

// Negative stock allowed by the business setting (owner request: recorded stock can be wrong).
{
  let nl = [createEmptyVoucherLine('row')];
  const zero = applyScannedBatch(nl, hit({ id: 'N', name: 'Zero Lens' }, b('n1', '-3.00', 'N1'), 0), 90, { allowNegative: true });
  assert.ok(zero.ok); assert.equal(zero.negativeStock, true); assert.match(zero.message, /Warning: recorded stock is 0, this sale takes it to -1/);
  assert.equal(zero.lines[0].quantity, 1); assert.equal(zero.lines[0].batches?.[0].batchId, 'n1');
  const again = applyScannedBatch(zero.lines, hit({ id: 'N', name: 'Zero Lens' }, b('n1', '-3.00', 'N1'), 0), 90, { allowNegative: true });
  assert.ok(again.ok); assert.equal(again.lines[0].quantity, 2); assert.match(again.message, /takes it to -2/);
  // Stock available: no warning flag even when allowed.
  const fine = applyScannedBatch([createEmptyVoucherLine('row')], hit({ id: 'M', name: 'M' }, b('m1', '1.00', 'M1'), 4), 10, { allowNegative: true });
  assert.ok(fine.ok); assert.equal(fine.negativeStock, undefined); assert.doesNotMatch(fine.message, /Warning/);
  // Setting off (default option): still refused, nothing added.
  const off = applyScannedBatch([createEmptyVoucherLine('row')], hit({ id: 'N', name: 'Zero Lens' }, b('n1', '-3.00', 'N1'), 0), 90, { allowNegative: false });
  assert.equal(off.ok, false);
  // Editing a saved voucher: the voucher's own original qty is still counted before any warning.
  const edit = applyScannedBatch([createEmptyVoucherLine('row')], hit({ id: 'E', name: 'E' }, b('e1', '1.00', 'E1'), 0), 10, { allowNegative: true, originalQty: () => 2 });
  assert.equal(edit.negativeStock, undefined);
  // Purchase never warns.
  const pur = applyScannedBatch([createEmptyVoucherLine('row')], hit({ id: 'P', name: 'P' }, b('p1', '1.00', 'P1'), 0), 10, { purchase: true });
  assert.ok(pur.ok); assert.equal(pur.negativeStock, undefined);
}
console.log('PASS negative stock scan cases');
