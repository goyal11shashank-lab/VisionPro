import { pool, db } from '../db/index.js';
import { businesses, whatsappSessions, whatsappMessagesQueue, salesInvoices, parties } from '../db/schema.js';
import { WhatsAppConnectionManager } from '../services/whatsapp/whatsappConnectionManager.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import { eq } from 'drizzle-orm';
import assert from 'assert';

async function runSendMessageTests() {
  console.log('🧪 Starting WhatsApp Send Message & Delivery Test Suite...\n');

  // Fetch 2 test businesses
  const bizList = await db.select().from(businesses).limit(2);
  assert.ok(bizList.length >= 2, 'Need 2 test businesses');
  const bizA = bizList[0].id;
  const bizB = bizList[1].id;

  // Track messages sent via mock
  const sentMessages: Array<{ businessId: string; jid: string; content: any }> = [];
  let shouldFailSend = false;

  WhatsAppConnectionManager.setTransportFactory(async ({ businessId, saveCreds }) => {
    const listeners: Record<string, Function[]> = {};
    const mockSocket = {
      user: { id: '919876543210:1@s.whatsapp.net', name: 'Optical ERP Store' },
      ev: {
        on: (event: string, handler: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
      },
      emit: (event: string, ...args: any[]) => {
        (listeners[event] || []).forEach((h) => h(...args));
      },
      sendMessage: async (jid: string, content: any) => {
        if (shouldFailSend) {
          throw new Error('Baileys socket network timeout');
        }
        sentMessages.push({ businessId, jid, content });
        return { key: { id: `baileys-msg-${Date.now()}` } };
      },
      requestPairingCode: async () => '1234-5678',
      logout: async () => {},
      end: () => {},
    };

    await saveCreds();
    setTimeout(() => {
      mockSocket.emit('connection.update', { connection: 'open' });
    }, 10);

    return mockSocket;
  });

  try {
    // Clean up previous test queue and sessions
    await WhatsAppConnectionManager.disconnect(bizA);
    await WhatsAppConnectionManager.disconnect(bizB);

    // -------------------------------------------------------------
    // Test 1: Sending when disconnected must fail with clear fallback
    // -------------------------------------------------------------
    console.log('--- 1. Testing send attempt while disconnected ---');
    try {
      await WhatsAppConnectionManager.sendMessage(bizA, '9876543210', { text: 'Test offline' });
      assert.fail('Should have thrown disconnected error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('not connected'),
        'Error must clearly state WhatsApp is not connected'
      );
      console.log('  ✅ PASS: Disconnected send attempt rejected with clear instruction');
    }

    // -------------------------------------------------------------
    // Test 2: Connect Business A and verify message transmission
    // -------------------------------------------------------------
    console.log('\n--- 2. Connecting session and verifying message transmission ---');
    await WhatsAppConnectionManager.connect(bizA, true);
    // Allow connection.update 'open' to process
    await new Promise((r) => setTimeout(r, 50));

    const statusA = await WhatsAppConnectionManager.getStatus(bizA);
    assert.strictEqual(statusA.status, 'CONNECTED', 'Business A must be connected');

    sentMessages.length = 0;
    const sendRes = await WhatsAppConnectionManager.sendMessage(bizA, '9876543210', {
      text: 'Hello from Optical ERP! Your invoice is ready.',
    });

    assert.ok(sendRes?.key?.id, 'Returned message ID');
    assert.strictEqual(sentMessages.length, 1, 'Mock socket received 1 send call');
    assert.strictEqual(
      sentMessages[0].jid,
      '919876543210@s.whatsapp.net',
      'Normalized to Indian WhatsApp JID 91XXXXXXXXXX@s.whatsapp.net'
    );
    assert.strictEqual(
      sentMessages[0].content.text,
      'Hello from Optical ERP! Your invoice is ready.'
    );
    console.log('  ✅ PASS: WhatsAppConnectionManager.sendMessage delivered formatted message to Baileys socket');

    // -------------------------------------------------------------
    // Test 3: Test enqueueInvoiceMessage with forceImmediate: true
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing queue dispatch and database record audit ---');
    sentMessages.length = 0;
    const testKey = `test-dispatch-${Date.now()}`;
    const dispatchResult = await WhatsAppService.enqueueInvoiceMessage({
      businessId: bizA,
      recipientPhone: '9876543210',
      recipientName: 'Rahul Verma',
      messageText: 'Tax Invoice #INV-1002 total Rs 4,500.00',
      idempotencyKey: testKey,
      forceImmediate: true,
    });

    const resSuccess = (dispatchResult as any).success;
    const resJob = (dispatchResult as any).job;
    assert.strictEqual(resSuccess, true, 'Dispatch must report success: true');
    assert.strictEqual(resJob?.status, 'SENT', 'Queue record status must be SENT');
    assert.ok(resJob?.sentAt, 'Queue record must have sentAt timestamp');
    assert.strictEqual(sentMessages.length, 1, 'Transport transmitted message');
    console.log('  ✅ PASS: WhatsAppService.enqueueInvoiceMessage completed end-to-end delivery');

    // -------------------------------------------------------------
    // Test 4: Socket transmission failure handling
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing socket failure handling and error state ---');
    shouldFailSend = true;
    const failKey = `test-fail-${Date.now()}`;
    const failDispatch: any = await WhatsAppService.enqueueInvoiceMessage({
      businessId: bizA,
      recipientPhone: '9876543210',
      recipientName: 'Rahul Verma',
      messageText: 'This send will fail',
      idempotencyKey: failKey,
      forceImmediate: true,
    });

    assert.strictEqual(failDispatch.success, false, 'Dispatch must report success: false on socket failure');
    assert.ok(failDispatch.error?.includes('timeout') || failDispatch.error?.includes('Failed'), 'Returns exact error');
    assert.ok(failDispatch.fallbackWaMeUrl?.includes('wa.me/919876543210'), 'Provides 1-click wa.me fallback link');
    console.log('  ✅ PASS: Socket network error gracefully handled with clear user feedback and fallback wa.me URL');

    // -------------------------------------------------------------
    // Test 5: Tenant isolation
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing multi-tenant session isolation ---');
    const statusB = await WhatsAppConnectionManager.getStatus(bizB);
    assert.strictEqual(statusB.status, 'DISCONNECTED', 'Business B remains disconnected');

    try {
      await WhatsAppConnectionManager.sendMessage(bizB, '9876543210', { text: 'Tenant leak test' });
      assert.fail('Business B must not be able to send');
    } catch (err: any) {
      assert.ok(err.message.includes('not connected'), 'Business B isolated');
      console.log('  ✅ PASS: Strict tenant isolation maintained between businesses');
    }

    // Clean up
    await pool.query(`DELETE FROM whatsapp_messages_queue WHERE business_id = $1`, [bizA]);
    await WhatsAppConnectionManager.disconnect(bizA);
    WhatsAppConnectionManager.resetTransportFactory();

    console.log('\n===========================================');
    console.log('🎉 ALL WHATSAPP SEND MESSAGE TESTS PASSED!');
    console.log('===========================================\n');
  } catch (err) {
    console.error('Fatal error during send message tests:', err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runSendMessageTests();
