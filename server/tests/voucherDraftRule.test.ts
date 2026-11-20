import assert from 'node:assert/strict';
const store = new Map<string, string>();
const ls: any = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
(globalThis as any).window = { localStorage: ls };
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const { hasEnteredVoucherData } = await import('../../src/utils/voucherDirtyHelper.js');
const { saveVoucherDraft, getVoucherDraft } = await import('../../src/utils/voucherDraftStorage.js');
const blank = { quantity: 0, batches: [] as any[] };
const base: any = { partyId: '', lines: [blank] };
// All three empty: nothing else keeps a draft.
for (const extra of [{ notes: 'hello' }, { referenceNumber: 'R1' }, { courierCharges: 50 }, { invoiceDiscount: 10 }, { invoiceGstRate: 12 }, { paymentMode: 'CASH' },
  { lines: [{ quantity: 5, rate: 100, discountValue: 5, gstRate: 12, batches: [{ quantity: 3, rate: 90 }] }] }]) {
  const f = { ...base, ...extra };
  assert.equal(hasEnteredVoucherData(f), false, JSON.stringify(extra));
  assert.equal(saveVoucherDraft('b1', 'u1', 'SALES', null, f), false);
  assert.equal(getVoucherDraft('b1', 'u1', 'SALES', null), null);
}
assert.equal(hasEnteredVoucherData(null), false);
// Any one of party / item / batch keeps it.
const keep: any[] = [{ partyId: 'P1', lines: [blank] }, { partyId: '', lines: [{ uniqueItemId: 'I1' }] }, { partyId: '', lines: [{ batches: [{ batchId: 'B1' }] }] }];
for (const f of keep) { assert.equal(hasEnteredVoucherData(f), true); assert.equal(saveVoucherDraft('b1', 'u1', 'PURCHASE', null, f), true); assert.ok(getVoucherDraft('b1', 'u1', 'PURCHASE', null)); }
// Draft previously saved, then user clears the three fields: draft is removed.
saveVoucherDraft('b1', 'u1', 'SALES', null, keep[0]); assert.ok(getVoucherDraft('b1', 'u1', 'SALES', null));
assert.equal(saveVoucherDraft('b1', 'u1', 'SALES', null, { partyId: '', notes: 'x', lines: [blank] } as any), false);
assert.equal(getVoucherDraft('b1', 'u1', 'SALES', null), null);
// Old stored draft that only has narration/charges is not offered for restore.
assert.equal(hasEnteredVoucherData({ partyId: '', notes: 'old', courierCharges: 20, lines: [{ quantity: 2, rate: 5 }] } as any), false);
console.log('PASS voucher draft rule');
