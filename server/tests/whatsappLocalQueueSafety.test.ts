import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { WhatsAppService as Service } from '../services/whatsapp/whatsappService.js';
import { WhatsAppConnectionManager as Manager } from '../services/whatsapp/whatsappConnectionManager.js';

// Never run this test on an external database. Transport is mocked before dispatch.
const url = new URL(process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Local restored database only');
assert.equal(url.pathname, '/erp_restore');
const prefix = `local-queue-test-${crypto.randomUUID()}`;
const phone = '7011865602';
const oldGetStatus = Manager.getStatus;
const oldSend = Manager.sendMessage;
let sends = 0;
let sawImage = false;
try {
  const invoice = (await pool.query("SELECT id,business_id FROM sales_invoices WHERE status='POSTED' LIMIT 1")).rows[0];
  assert.ok(invoice);
  const businessId = invoice.business_id;
  const enqueue = (key: string, image = false) => Service.enqueueInvoiceMessage({ businessId, invoiceId: image ? invoice.id : undefined, recipientPhone: phone, messageText: 'LOCAL MOCK ONLY', idempotencyKey: `${prefix}-${key}`, forceImmediate: false });
  process.env.WHATSAPP_TEST_RECIPIENT = phone;
  process.env.WHATSAPP_SEND_ENABLED = 'false';
  await assert.rejects(enqueue('disabled'), /disabled/);
  assert.equal(Number((await pool.query('SELECT count(*) FROM whatsapp_messages_queue WHERE idempotency_key LIKE $1', [`${prefix}%`])).rows[0].count), 0);
  process.env.WHATSAPP_SEND_ENABLED = 'true';
  Manager.getStatus = async () => ({ status: 'CONNECTED' } as any);
  Manager.sendMessage = async (_business, _phone, content) => {
    sends++;
    if (content.imageBuffer) { assert.equal(content.imageBuffer.subarray(0,8).toString('hex'), '89504e470d0a1a0a'); sawImage = true; }
    await new Promise(resolve => setTimeout(resolve, 40));
    return { key: { id: `mock-${sends}` } } as any;
  };
  const queued = await enqueue('concurrent');
  const id = queued.job!.id;
  const responses = await Promise.all([Service.dispatchQueueItem(id), Service.dispatchQueueItem(id)]);
  assert.equal(sends, 1, 'Concurrent dispatch must only call transport once');
  assert.equal(responses.filter(r => r.success === true).length, 1);
  await Service.dispatchQueueItem(id);
  assert.equal(sends, 1, 'Already sent job must not resend');
  const image = await enqueue('image', true);
  await Service.dispatchQueueItem(image.job!.id);
  assert.equal(sends, 2); assert.equal(sawImage, true);
  const uncertain = await enqueue('uncertain');
  Manager.sendMessage = async () => { sends++; throw new Error('mock outcome unknown'); };
  const failed = await Service.dispatchQueueItem(uncertain.job!.id);
  assert.equal(failed.success, false);
  assert.equal((failed.job!.metadata as any).deliveryUncertain, true);
  await assert.rejects(Service.retryQueueItem(businessId, uncertain.job!.id), /outcome is uncertain/);
  assert.equal(sends, 3, 'Uncertain send must not retry');
  console.log('Local queue tests PASS: disabled enqueue writes zero rows, concurrent claim sends once, sent replay blocked, stored invoice rendered to real PNG, uncertain retry blocked. No real messaging transport used.');
} finally {
  Manager.getStatus = oldGetStatus; Manager.sendMessage = oldSend;
  const cleanup = await pool.query('DELETE FROM whatsapp_messages_queue WHERE idempotency_key LIKE $1', [`${prefix}%`]);
  console.log(`Removed ${cleanup.rowCount} local test queue rows.`);
  await pool.end();
}
