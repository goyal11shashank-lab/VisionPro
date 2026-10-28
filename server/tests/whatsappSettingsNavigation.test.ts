import assert from 'node:assert';
import { WhatsAppConnectionManager } from '../services/whatsapp/whatsappConnectionManager.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import { db } from '../db/index.js';
import { whatsappSessions, businesses } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting WhatsApp Settings -> Transaction Message Verification Suite...\n');

async function runTests() {
  // Test 1: Verify BusinessSettingsPage.tsx has Transaction Message and no duplicate WhatsApp Integration group
  console.log('--- 1. Testing BusinessSettingsPage UI Configuration ---');
  const settingsPageContent = fs.readFileSync(
    path.join(process.cwd(), 'src/pages/admin/BusinessSettingsPage.tsx'),
    'utf-8'
  );

  assert.ok(
    settingsPageContent.includes("id: 'transactionMessage'"),
    'Must have transactionMessage setting group id'
  );
  assert.ok(
    settingsPageContent.includes("name: 'Transaction Message'"),
    'Must have setting group name "Transaction Message"'
  );
  assert.ok(
    !settingsPageContent.includes("name: 'WhatsApp Integration'"),
    'Must NOT have duplicate "WhatsApp Integration" group name in settingGroups'
  );
  assert.ok(
    settingsPageContent.includes("activeTab === 'transactionMessage'"),
    'Must render active tab transactionMessage'
  );
  assert.ok(
    !settingsPageContent.includes("activeTab === 'whatsapp'"),
    'Must NOT render old active tab whatsapp separately'
  );
  assert.ok(
    settingsPageContent.includes("whatsapp: 'transactionMessage'"),
    'Legacy whatsapp tab parameter must normalize to transactionMessage'
  );
  console.log('  ✅ PASS: BusinessSettingsPage.tsx has Transaction Message group with no duplicates');

  // Test 2: Verify WhatsAppSettingsSection.tsx has WhatsApp Web Login header and action controls
  console.log('--- 2. Testing WhatsAppSettingsSection Component Controls ---');
  const sectionContent = fs.readFileSync(
    path.join(process.cwd(), 'src/components/whatsapp/WhatsAppSettingsSection.tsx'),
    'utf-8'
  );

  assert.ok(
    sectionContent.includes('id="section-whatsapp-web-login"'),
    'Must have id="section-whatsapp-web-login" container'
  );
  assert.ok(
    sectionContent.includes('WhatsApp Web Login'),
    'Must have clearly labeled "WhatsApp Web Login" header'
  );
  assert.ok(
    sectionContent.includes('id="btn-connect-whatsapp"'),
    'Must have Connect WhatsApp button with id="btn-connect-whatsapp"'
  );
  assert.ok(
    sectionContent.includes('Connect WhatsApp'),
    'Must have button labeled Connect WhatsApp'
  );
  assert.ok(
    sectionContent.includes('id="btn-test-whatsapp-connection"'),
    'Must have Test Connection button with id="btn-test-whatsapp-connection"'
  );
  assert.ok(
    sectionContent.includes('id="btn-disconnect-whatsapp"'),
    'Must have Disconnect WhatsApp button with id="btn-disconnect-whatsapp"'
  );
  assert.ok(
    sectionContent.includes('session?.connectedPhone'),
    'Must display connected phone number'
  );
  assert.ok(
    sectionContent.includes('session?.connectedPushname'),
    'Must display connected account name'
  );
  assert.ok(
    sectionContent.includes('qrCountdown'),
    'Must display QR countdown'
  );
  console.log('  ✅ PASS: WhatsAppSettingsSection.tsx contains all required WhatsApp Web Login elements');

  // Test 3: Verify App.tsx and Sidebar.tsx routing
  console.log('--- 3. Testing App.tsx and Sidebar.tsx Routing ---');
  const appContent = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
  assert.ok(
    appContent.includes("case '/admin/transaction-message-settings':"),
    'App.tsx must have route for /admin/transaction-message-settings'
  );
  assert.ok(
    appContent.includes("initialTab=\"transactionMessage\""),
    'Route must pass initialTab="transactionMessage"'
  );

  const sidebarContent = fs.readFileSync(path.join(process.cwd(), 'src/components/layout/Sidebar.tsx'), 'utf-8');
  assert.ok(
    sidebarContent.includes("label: 'Transaction Message'"),
    'Sidebar must have Transaction Message navigation item'
  );
  assert.ok(
    sidebarContent.includes("path: '/admin/transaction-message-settings'"),
    'Sidebar item must link to /admin/transaction-message-settings'
  );
  console.log('  ✅ PASS: Routing and Sidebar navigation configured for Settings -> Transaction Message');

  // Test 4: Verify Backend Integration and Session Persistence
  console.log('--- 4. Testing WhatsApp Connection Manager Persistence & Isolation ---');
  const allBiz = await db.select().from(businesses).limit(2);
  assert.ok(allBiz.length >= 2, 'Need at least 2 businesses for multi-tenant isolation test');
  const bizA = allBiz[0].id;
  const bizB = allBiz[1].id;

  // Set mock transport
  const activeMocks = new Map<string, any>();
  WhatsAppConnectionManager.setTransportFactory(async ({ sessionDir }) => {
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const mock = {
      ev: {
        on: (event: string, handler: (...args: any[]) => void) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        },
      },
      emit: (event: string, ...args: any[]) => {
        listeners.get(event)?.forEach((fn) => fn(...args));
      },
      logout: async () => {},
      end: () => {},
    };
    activeMocks.set(bizA, mock);
    return mock;
  });

  // Clean initial state
  await WhatsAppConnectionManager.disconnect(bizA);
  await WhatsAppConnectionManager.disconnect(bizB);

  // 1. Connect WhatsApp displays real QR challenge
  await WhatsAppConnectionManager.connect(bizA, true);
  const mockA = activeMocks.get(bizA);
  const rawQrChallenge = '2@MOCK-PAIRING-TOKEN-12345,67890,WA-WEB-AUTH';
  mockA?.emit('connection.update', { qr: rawQrChallenge });
  await new Promise((r) => setTimeout(r, 100));

  const qrResult = await WhatsAppConnectionManager.getQR(bizA);
  assert.ok(qrResult.qrCodeData && qrResult.qrCodeData.startsWith('data:image/png;base64,'), 'QR challenge must be PNG data URL');
  assert.ok(qrResult.expiresInSeconds > 0, 'Must have positive expiration seconds');

  // 2. Refreshing preserves state
  const statusA = await WhatsAppConnectionManager.getStatus(bizA);
  assert.strictEqual(statusA.status, 'QR_REQUIRED', 'Status must be preserved across checks');
  assert.ok(statusA.qrCodeData, 'Active QR must still be available on refresh');

  // 3. Multi-tenant isolation: bizB is still disconnected
  const statusB = await WhatsAppConnectionManager.getStatus(bizB);
  assert.strictEqual(statusB.status, 'DISCONNECTED', 'Business B must remain disconnected');

  // 4. Test Connection and Disconnect
  // Simulate mobile scan and authenticated open event
  if (mockA) {
    mockA.user = {
      id: '919988776655:1@s.whatsapp.net',
      name: 'Optical Retailer HQ',
    };
    mockA.emit('connection.update', { connection: 'open' });
  }
  await new Promise((r) => setTimeout(r, 60));

  const testConnResult = await WhatsAppService.testConnection(bizA);
  assert.strictEqual(testConnResult.success, true, 'Test connection must succeed for connected session');

  const refreshedConnected = await WhatsAppConnectionManager.getStatus(bizA);
  assert.strictEqual(refreshedConnected.status, 'CONNECTED');
  assert.strictEqual(refreshedConnected.connectedPhone, '+919988776655');
  assert.strictEqual(refreshedConnected.connectedPushname, 'Optical Retailer HQ');

  // Disconnect
  await WhatsAppConnectionManager.disconnect(bizA);
  const statusAfterDisconnect = await WhatsAppConnectionManager.getStatus(bizA);
  assert.strictEqual(statusAfterDisconnect.status, 'DISCONNECTED');
  console.log('  ✅ PASS: Backend WhatsApp endpoints, state persistence, and tenant isolation verified');

  console.log('\n======================================================================');
  console.log('All 4 acceptance test suites PASSED successfully!');
  console.log('======================================================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
