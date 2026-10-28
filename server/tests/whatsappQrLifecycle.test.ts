import { pool, db } from '../db/index.js';
import { businesses, whatsappSessions } from '../db/schema.js';
import {
  WhatsAppConnectionManager,
  IWhatsAppSocketTransport,
  WhatsAppTransportFactory,
} from '../services/whatsapp/whatsappConnectionManager.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import fs from 'fs';
import path from 'path';

/**
 * Mock WhatsApp Socket Transport for automated unit & integration testing
 */
class MockWhatsAppSocket implements IWhatsAppSocketTransport {
  public user?: { id: string; name?: string; pushname?: string };
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  public isClosed = false;
  public isLoggedOut = false;

  constructor(public businessId: string) {
    this.user = undefined;
  }

  ev = {
    on: (event: string, handler: (...args: any[]) => void) => {
      const existing = this.listeners.get(event) || [];
      existing.push(handler);
      this.listeners.set(event, existing);
    },
  };

  emit(event: string, ...args: any[]) {
    const handlers = this.listeners.get(event) || [];
    for (const h of handlers) {
      h(...args);
    }
  }

  async logout(): Promise<void> {
    this.isLoggedOut = true;
    this.isClosed = true;
  }

  end(error?: Error): void {
    this.isClosed = true;
  }
}

async function runWhatsAppLifecycleTests() {
  console.log('🧪 Starting WhatsApp Web QR Login & Session Lifecycle Test Suite...\n');
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

  // Active mock sockets map for test control
  const activeMocks = new Map<string, MockWhatsAppSocket>();

  const mockFactory: WhatsAppTransportFactory = async ({ businessId, saveCreds }) => {
    const mock = new MockWhatsAppSocket(businessId);
    activeMocks.set(businessId, mock);
    // Simulate auto-save creds
    await saveCreds();
    return mock;
  };

  try {
    // 0. Ensure at least two businesses exist for multi-tenant isolation testing
    let bizList = await db.select().from(businesses).limit(2);
    if (bizList.length < 2) {
      const [newBiz] = await db
        .insert(businesses)
        .values({
          name: 'Vision Test Clinic B',
          tradeName: 'Vision Clinic B',
          email: `test-biz-b-${Date.now()}@example.com`,
          phone: '9876543299',
        })
        .returning();
      bizList = await db.select().from(businesses).limit(2);
    }

    const bizA = bizList[0].id;
    const bizB = bizList[1].id;

    console.log(`Test Context: Business A (${bizA}), Business B (${bizB})`);

    // Set mock transport
    WhatsAppConnectionManager.setTransportFactory(mockFactory);

    // =========================================================================
    // 1. Initial State Check
    // =========================================================================
    console.log('\n--- 1. Initial Session State & Clean Baseline ---');
    await WhatsAppConnectionManager.disconnect(bizA);
    await WhatsAppConnectionManager.disconnect(bizB);

    const initialStatusA = await WhatsAppConnectionManager.getStatus(bizA);
    assert(
      initialStatusA.status === 'DISCONNECTED' &&
        initialStatusA.qrCodeData === null &&
        initialStatusA.connectedPhone === null,
      'Business A starts cleanly in DISCONNECTED state'
    );

    const initialStatusB = await WhatsAppConnectionManager.getStatus(bizB);
    assert(
      initialStatusB.status === 'DISCONNECTED',
      'Business B starts cleanly in DISCONNECTED state'
    );

    // =========================================================================
    // 2. Connection Initiation & QR Challenge Generation
    // =========================================================================
    console.log('\n--- 2. Authorized Connection Initiation & QR Challenge ---');
    await WhatsAppConnectionManager.connect(bizA, true);

    const mockA = activeMocks.get(bizA);
    assert(!!mockA, 'Underlying WhatsApp transport instance created for Business A');

    // Emit QR challenge from transport
    const rawQrChallenge = '2@MOCK-PAIRING-TOKEN-12345,67890,WA-WEB-AUTH';
    mockA?.emit('connection.update', { qr: rawQrChallenge });

    // Allow async handleConnectionUpdate & QRCode.toDataURL to complete
    await new Promise((r) => setTimeout(r, 100));
    const qrStatus = await WhatsAppConnectionManager.getStatus(bizA);

    assert(qrStatus.status === 'QR_REQUIRED', 'Session state transitions to QR_REQUIRED upon QR event');
    assert(
      typeof qrStatus.qrCodeData === 'string' && qrStatus.qrCodeData.startsWith('data:image/png;base64,'),
      'QR Code challenge is rendered as a valid PNG data URL'
    );
    assert(
      qrStatus.qrExpiresAt !== null && !qrStatus.isQrExpired,
      'QR expiration timestamp is set and valid'
    );

    const qrEndpointRes = await WhatsAppConnectionManager.getQR(bizA);
    assert(
      qrEndpointRes.status === 'QR_REQUIRED' && qrEndpointRes.expiresInSeconds > 0,
      'getQR helper returns active QR challenge and positive remaining seconds'
    );

    // =========================================================================
    // 3. Successful Mobile Authentication Event
    // =========================================================================
    console.log('\n--- 3. Handling Mobile Phone QR Scan & Authentication ---');
    // Set user info on mock and emit open event
    if (mockA) {
      mockA.user = {
        id: '919876543210:4@s.whatsapp.net',
        name: 'Apex Vision Clinic Main',
      };
      mockA.emit('connection.update', { connection: 'open' });
    }

    await new Promise((r) => setTimeout(r, 50));
    const connectedStatus = await WhatsAppConnectionManager.getStatus(bizA);

    assert(connectedStatus.status === 'CONNECTED', 'Session successfully transitions to CONNECTED');
    assert(
      connectedStatus.connectedPhone === '+919876543210',
      'Connected mobile phone number parsed and formatted (+919876543210)'
    );
    assert(
      connectedStatus.connectedPushname === 'Apex Vision Clinic Main',
      'Connected account pushname/display name captured'
    );
    assert(connectedStatus.qrCodeData === null, 'QR Code is purged once connected');
    assert(connectedStatus.lastConnectedAt !== null, 'lastConnectedAt timestamp recorded');

    // Verify Neon database persistence
    const dbRows = await pool.query(
      `SELECT status, connected_phone, connected_pushname FROM whatsapp_sessions WHERE business_id = $1`,
      [bizA]
    );
    assert(
      dbRows.rows.length === 1 &&
        dbRows.rows[0].status === 'CONNECTED' &&
        dbRows.rows[0].connected_phone === '+919876543210',
      'Connected state and phone persisted accurately in PostgreSQL database'
    );

    // =========================================================================
    // 4. Multi-Tenant Business Isolation
    // =========================================================================
    console.log('\n--- 4. Multi-Tenant Business Isolation Verification ---');
    const statusB = await WhatsAppConnectionManager.getStatus(bizB);
    assert(
      statusB.status === 'DISCONNECTED' && statusB.connectedPhone === null,
      'Business B remains completely DISCONNECTED while Business A is CONNECTED'
    );

    // Connect Business B independently
    await WhatsAppConnectionManager.connect(bizB, true);
    const mockB = activeMocks.get(bizB);
    mockB?.emit('connection.update', { qr: '2@MOCK-QR-BIZ-B-TOKEN' });
    await new Promise((r) => setTimeout(r, 100));

    const statusBAfterQr = await WhatsAppConnectionManager.getStatus(bizB);
    assert(
      statusBAfterQr.status === 'QR_REQUIRED',
      'Business B transitions to QR_REQUIRED without affecting Business A'
    );

    const statusACheck = await WhatsAppConnectionManager.getStatus(bizA);
    assert(
      statusACheck.status === 'CONNECTED' && statusACheck.connectedPhone === '+919876543210',
      'Business A remains CONNECTED and unaffected by Business B operations'
    );

    // Disconnect Business B
    await WhatsAppConnectionManager.disconnect(bizB);
    await new Promise((r) => setTimeout(r, 50));
    const statusBAfterDisconnect = await WhatsAppConnectionManager.getStatus(bizB);
    assert(
      statusBAfterDisconnect.status === 'DISCONNECTED',
      'Business B cleanly disconnected'
    );

    const statusAStillConnected = await WhatsAppConnectionManager.getStatus(bizA);
    assert(
      statusAStillConnected.status === 'CONNECTED',
      'Business A still CONNECTED after Business B disconnect'
    );

    // =========================================================================
    // 5. Network Disruption & Reconnection Backoff
    // =========================================================================
    console.log('\n--- 5. Temporary Disconnect & Reconnection Backoff ---');
    mockA?.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 503 } }, // Temporary network disruption
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    const reconnectingStatus = await WhatsAppConnectionManager.getStatus(bizA);
    assert(
      reconnectingStatus.status === 'RECONNECTING' && reconnectingStatus.reconnectAttempts >= 1,
      'Temporary disconnect triggers RECONNECTING state with incremented attempt count'
    );

    // =========================================================================
    // 6. Mobile Phone Logout / Session Revocation
    // =========================================================================
    console.log('\n--- 6. Mobile Phone Revocation (Logged Out) ---');
    // Ensure credentials directory exists
    const sessionDirA = WhatsAppConnectionManager.getSessionDir(bizA);
    if (!fs.existsSync(sessionDirA)) fs.mkdirSync(sessionDirA, { recursive: true });
    fs.writeFileSync(path.join(sessionDirA, 'creds.json'), '{"mock": true}');

    assert(
      WhatsAppConnectionManager.hasStoredCredentials(bizA),
      'Stored credentials exist on disk prior to revocation'
    );

    // Simulate 401 / loggedOut from phone
    mockA?.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 401 } },
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    const loggedOutStatus = await WhatsAppConnectionManager.getStatus(bizA);
    assert(
      loggedOutStatus.status === 'DISCONNECTED',
      'Phone logout event transitions status immediately to DISCONNECTED'
    );
    assert(
      !WhatsAppConnectionManager.hasStoredCredentials(bizA),
      'Disk credentials purged automatically upon phone logout'
    );

    // =========================================================================
    // 7. Session Recovery on Server Startup
    // =========================================================================
    console.log('\n--- 7. Session Recovery After Server Restart ---');
    // Simulate valid saved credentials for Business A
    if (!fs.existsSync(sessionDirA)) fs.mkdirSync(sessionDirA, { recursive: true });
    fs.writeFileSync(path.join(sessionDirA, 'creds.json'), '{"recovered": true}');

    await pool.query(
      `UPDATE whatsapp_sessions SET status = 'CONNECTED' WHERE business_id = $1`,
      [bizA]
    );

    // Trigger restoreAllSessions
    await WhatsAppConnectionManager.restoreAllSessions();
    await new Promise((r) => setTimeout(r, 50));

    const restoredMock = activeMocks.get(bizA);
    assert(
      !!restoredMock,
      'restoreAllSessions successfully re-initiates connection for previously connected business'
    );

    // Clean up
    await WhatsAppConnectionManager.disconnect(bizA);
    await WhatsAppConnectionManager.disconnect(bizB);
    WhatsAppConnectionManager.resetTransportFactory();

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n======================================================');
    console.log(`WhatsApp QR Lifecycle Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('======================================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during WhatsApp lifecycle test:', err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runWhatsAppLifecycleTests();
