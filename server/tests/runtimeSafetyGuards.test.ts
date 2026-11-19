import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installSessionLogRedaction} from '../services/whatsapp/sessionLogRedaction.js';
const calls:unknown[][]=[];
const fake={info:(...args:unknown[])=>calls.push(args),warn:(...args:unknown[])=>calls.push(args)};
installSessionLogRedaction(fake);
const sensitive={get secret(){throw Error('Session object must not be inspected');}};
for(const prefix of ['Closing session:','Opening session:','Session already closed','Removing old closed session:']){
 fake.info(prefix,sensitive);fake.warn(prefix,sensitive);
}
assert.equal(calls.length,8);
for(const call of calls){assert.equal(call.length,1);assert.equal(typeof call[0],'string');assert.ok(String(call[0]).includes('redacted'));}
const ordinary={count:3};fake.info('Ordinary status',ordinary);fake.warn('Ordinary warning',42);
assert.deepEqual(calls.slice(-2),[['Ordinary status',ordinary],['Ordinary warning',42]]);
const auth=readFileSync(new URL('../routes/auth.ts',import.meta.url),'utf8');
assert.ok(!auth.includes('ensureMigrationsRun'));assert.ok(!auth.includes('runMigrations('));
const manager=readFileSync(new URL('../services/whatsapp/whatsappConnectionManager.ts',import.meta.url),'utf8');assert.ok(manager.startsWith("import './sessionLogRedaction.js';"));
console.log('Sensitive session logging redacted, ordinary logs preserved, auth migration side effects absent PASS');
