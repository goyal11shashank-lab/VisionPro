import { pool, db } from '../db/index.js';
import { WhatsAppService, DEFAULT_WHATSAPP_CONFIG } from '../services/whatsapp/whatsappService.js';
import { whatsappSessions, whatsappMessagesQueue, businesses, parties, salesInvoices } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

async function runWhatsAppTests() {
  console.log('🧪 Starting WhatsApp Integration Test Suite...');
  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      testsPassed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, details || '');
      testsFailed++;
    }
  }

  try {
    // =========================================================================
    // 1. Phone Number Normalization Tests
    // =========================================================================
    console.log('\n--- 1. Testing Phone Normalization & Validation ---');
    
    const p1 = WhatsAppService.normalizePhoneNumber('9876543210');
    assert(p1.valid && p1.normalized === '919876543210', '10-digit Indian number normalized to 91XXXXXXXXXX');

    const p2 = WhatsAppService.normalizePhoneNumber('+91 98765 43210');
    assert(p2.valid && p2.normalized === '919876543210', '+91 formatted number with spaces stripped');

    const p3 = WhatsAppService.normalizePhoneNumber('09876543210');
    assert(p3.valid && p3.normalized === '919876543210', 'Leading 0 stripped for Indian number');

    const p4 = WhatsAppService.normalizePhoneNumber('12345');
    assert(!p4.valid && typeof p4.error === 'string', 'Short invalid phone number rejected');

    const p5 = WhatsAppService.normalizePhoneNumber('');
    assert(!p5.valid, 'Empty phone number rejected');

    // =========================================================================
    // 2. Template Interpolation & wa.me Link Generation Tests
    // =========================================================================
    console.log('\n--- 2. Testing Template Interpolation & wa.me Generator ---');

    const template = 'Hello {{customer_name}}, bill #{{invoice_number}} for {{invoice_total}} from {{business_name}}';
    const interpolated = WhatsAppService.interpolateTemplate(template, {
      customer_name: 'Dr. Ramesh Sharma',
      invoice_number: 'INV-2026-001',
      invoice_total: 1540.50,
      business_name: 'Apex Vision Clinic',
    });

    assert(
      interpolated.includes('Dr. Ramesh Sharma') &&
      interpolated.includes('INV-2026-001') &&
      interpolated.includes('₹1,540.50') &&
      interpolated.includes('Apex Vision Clinic'),
      'Template variables correctly interpolated with formatted rupee total'
    );

    const waLink = WhatsAppService.generateWaMeLink('9876543210', 'Your invoice is ready');
    assert(
      waLink.startsWith('https://wa.me/919876543210?text='),
      'wa.me link generated with normalized digits and query parameter'
    );

    // =========================================================================
    // 3. Database & QR Session Lifecycle Tests
    // =========================================================================
    console.log('\n--- 3. Testing WhatsApp Web QR Session Lifecycle ---');

    // Fetch an existing business
    const [biz] = await db.select().from(businesses).limit(1);
    if (!biz) {
      throw new Error('No business found in database to run tests against');
    }
    const testBusinessId = biz.id;

    // Test 3a: Initiate QR session
    const linkRes = await WhatsAppService.initiateLinkSession(testBusinessId);
    assert(
      linkRes.status === 'CONNECTING' && linkRes.qrCodeData?.startsWith('data:image/png;base64,'),
      'QR code link session initiated with real PNG data URL'
    );

    const sessionState = await WhatsAppService.getSession(testBusinessId);
    assert(
      sessionState.status === 'CONNECTING' && !sessionState.isQrExpired,
      'Session persisted in database with CONNECTING state'
    );

    // Test 3b: Confirm authentication
    const authRes = await WhatsAppService.confirmAuthentication(testBusinessId, {
      phone: '+91 98450 11223',
      pushname: 'Test Optical Dispatcher',
    });
    assert(
      authRes.status === 'CONNECTED' && authRes.connectedPhone === '+91 98450 11223',
      'Session successfully transitioned to CONNECTED'
    );

    // Test 3c: Test connection verification
    const testConnRes = await WhatsAppService.testConnection(testBusinessId);
    assert(
      testConnRes.success && testConnRes.status === 'CONNECTED' && typeof testConnRes.latencyMs === 'number',
      'testConnection succeeds for connected session with measured latency'
    );

    // =========================================================================
    // 4. Queue & Idempotency Tests
    // =========================================================================
    console.log('\n--- 4. Testing Durable Queue & Strict Idempotency ---');

    const testIdempotencyKey = `test-idemp-${Date.now()}`;
    const enqueue1 = await WhatsAppService.enqueueInvoiceMessage({
      businessId: testBusinessId,
      invoiceId: null,
      recipientPhone: '9876543210',
      recipientName: 'Test Customer',
      messageText: 'Test invoice message content',
      idempotencyKey: testIdempotencyKey,
      forceImmediate: true,
    });

    assert(
      !enqueue1.isDuplicate && (enqueue1.job.status === 'SENT' || enqueue1.job.status === 'PENDING'),
      'First message enqueue accepted and processed'
    );

    // Attempt double-send with SAME idempotency key
    const enqueue2 = await WhatsAppService.enqueueInvoiceMessage({
      businessId: testBusinessId,
      invoiceId: null,
      recipientPhone: '9876543210',
      recipientName: 'Test Customer',
      messageText: 'Test duplicate content',
      idempotencyKey: testIdempotencyKey,
      forceImmediate: true,
    });

    assert(
      enqueue2.isDuplicate === true && enqueue2.job.id === enqueue1.job.id,
      'Duplicate send blocked by idempotency key constraint'
    );

    // Clean up test queue records
    await pool.query(
      `DELETE FROM whatsapp_messages_queue WHERE business_id = $1 AND idempotency_key = $2`,
      [testBusinessId, testIdempotencyKey]
    );

    // Test 4b: Clean Disconnect
    const discRes = await WhatsAppService.disconnectSession(testBusinessId);
    assert(discRes.status === 'NOT_CONNECTED', 'Session cleanly disconnected');

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n===========================================');
    console.log(`WhatsApp Test Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('===========================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running WhatsApp tests:', err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runWhatsAppTests();
