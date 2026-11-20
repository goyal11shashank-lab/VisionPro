import assert from 'node:assert/strict';
import { resolveUniquePartyByName, resolveConfirmedPartyByName } from '../../src/lib/partyNameMatch.js';
const ps = [{ id: '1', name: 'Sham Trading' }, { id: '2', name: 'Vimal  Optical' }, { id: '3', name: 'Twin' }, { id: '4', name: 'twin' }, { id: '5', name: 'Sham Trading Co' }];
assert.equal(resolveUniquePartyByName(ps, 'sham trading')?.id, '1');
assert.equal(resolveUniquePartyByName(ps, '  SHAM   TRADING ')?.id, '1');
assert.equal(resolveUniquePartyByName(ps, 'Vimal Optical')?.id, '2');
assert.equal(resolveUniquePartyByName(ps, 'Sham'), null);
assert.equal(resolveUniquePartyByName(ps, 'Twin'), null);
assert.equal(resolveUniquePartyByName(ps, ''), null);
assert.equal(resolveUniquePartyByName([], 'x'), null);
const ok = (q: string, parties: any[], complete = true) => ({ query: q, complete, parties });
// Unique locally, but server shows a second exact-name party outside the fetched subset: no link.
assert.equal(resolveConfirmedPartyByName([{ id: '1', name: 'Sham Trading' }], 'Sham Trading', ok('Sham Trading', [{ id: '1', name: 'Sham Trading' }, { id: '9', name: 'sham trading' }])), null);
// Unique everywhere and server check is complete: link.
assert.equal(resolveConfirmedPartyByName([{ id: '1', name: 'Sham Trading' }], 'sham trading', ok('Sham Trading', [{ id: '1', name: 'Sham Trading' }]))?.id, '1');
// Server-only party (outside the fetched 200) links when complete.
assert.equal(resolveConfirmedPartyByName([], 'Far Away Optical', ok('Far Away Optical', [{ id: '7', name: 'Far Away Optical' }]))?.id, '7');
// No check, stale check (text changed), failed or truncated check: never link.
assert.equal(resolveConfirmedPartyByName([{ id: '1', name: 'Sham Trading' }], 'Sham Trading', null), null);
assert.equal(resolveConfirmedPartyByName([{ id: '1', name: 'Sham Trading' }], 'Sham Trading', ok('Sham', [{ id: '1', name: 'Sham Trading' }])), null);
assert.equal(resolveConfirmedPartyByName([{ id: '1', name: 'Sham Trading' }], 'Sham Trading', ok('Sham Trading', [{ id: '1', name: 'Sham Trading' }], false)), null);
// Partial typed text never links.
assert.equal(resolveConfirmedPartyByName([{ id: '1', name: 'Sham Trading' }], 'Sham', ok('Sham', [{ id: '1', name: 'Sham Trading' }])), null);
console.log('partyNameMatch 14/14 PASS');
