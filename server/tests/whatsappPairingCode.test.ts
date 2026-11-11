import { pool, db } from '../db/index.js';
import { businesses, whatsappSessions } from '../db/schema.js';
import { WhatsAppConnectionManager } from '../services/whatsapp/whatsappConnectionManager.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import assert from 'assert';

async function runPairingTests() {
  console.log('🧪 Starting WhatsApp Pairing Code & Reconnect Test Suite...\n');

  const bizList = await db.select().from(businesses).limit(1);
  assert.ok(bizList.length >= 1, 'Need at least 1 test business');
  const testBizId = bizList[0].id;

  let activeMock: any = null;
  WhatsAppConnectionManager.setTransportFactory(async ({ businessId, saveCreds }) => {
    const listeners: Record<string, Function[]> = {};
    activeMock = {
      user: undefined,
      ev: {
        on: (event: string, handler: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
      },
      emit: (event: string, ...args: any[]) => {
        (listeners[event] || []).forEach((h) => h(...args));
      },
      requestPairingCode: async (phone: string) => {
        return 'ABC1-XYZ2';
      },
      logout: async () => {},
      end: () => {},
    };

    await saveCreds();
    setTimeout(() => {
      activeMock?.emit('connection.update', { qr: '2@MOCK-QR-CODE' });
    }, 20);

    return activeMock;
  });

  try {
    await WhatsAppConnectionManager.disconnect(testBizId);

    // -------------------------------------------------------------
    // Test 1: Request Pairing Code via Phone Number
    // -------------------------------------------------------------
    console.log('--- 1. Testing Pairing Code Generation ---');
    const code = await WhatsAppConnectionManager.requestPairingCode(testBizId, '9876543210');
    assert.strictEqual(code, 'ABC1-XYZ2', 'Must return mock pairing code ABC1-XYZ2');
    console.log('  ✅ PASS: WhatsAppConnectionManager.requestPairingCode returned 8-digit pairing code');

    // -------------------------------------------------------------
    // Test 2: Handle 515 restartRequired during QR scan
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing 515 restartRequired Handshake ---');
    let restartHandled = false;
    // Emitting 515 restartRequired
    activeMock?.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 515 } },
      },
    });
    await new Promise((r) => setTimeout(r, 50));

    const statusAfter515 = await WhatsAppConnectionManager.getStatus(testBizId);
    assert.ok(
      statusAfter515.status === 'INITIALIZING' || statusAfter515.status === 'QR_REQUIRED',
      'Status stays responsive without entering unrecoverable error'
    );
    assert.strictEqual(statusAfter515.reconnectAttempts, 0, 'Reconnect attempts NOT incremented on 515');
    console.log('  ✅ PASS: 515 restartRequired handled gracefully with immediate reconnect logic');

    // -------------------------------------------------------------
    // Test 3: Disconnect cleanly
    // -------------------------------------------------------------
    console.log('\n--- 3. Clean Disconnect ---');
    await WhatsAppConnectionManager.disconnect(testBizId);
    const finalStatus = await WhatsAppConnectionManager.getStatus(testBizId);
    assert.strictEqual(finalStatus.status, 'DISCONNECTED', 'Status must be DISCONNECTED');
    console.log('  ✅ PASS: Clean disconnect verified');

    WhatsAppConnectionManager.resetTransportFactory();
    console.log('\n===========================================');
    console.log('🎉 ALL PAIRING CODE TESTS PASSED!');
    console.log('===========================================\n');
  } catch (err) {
    console.error('Fatal error during pairing code tests:', err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runPairingTests();
