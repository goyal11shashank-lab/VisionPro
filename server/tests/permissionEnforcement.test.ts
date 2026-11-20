import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
/**
 * PERMISSION ENFORCEMENT — RESTRICTED-ROLE ENDPOINT REGRESSION SUITE
 *
 * Verifies the scoped permission-enforcement patch (revision 4) on top of the tenant
 * isolation work: endpoints that previously required only authentication now enforce
 * module permissions, and Super Admin detection in search/dashboard uses the real flag.
 *
 *  1. REAL LOGIN: every fixture user authenticates through POST /api/auth/login with its
 *     own username/password (no minted tokens), proving the credential flow the user
 *     asked to have verified for staff logins.
 *  2. STAFF POSITIVES: a sales-only staff role can list sales orders and use sales
 *     number previews.
 *  3. STAFF WHATSAPP WRITE DENIALS: connect/settings/send/test-connection are denied in
 *     middleware BEFORE any WhatsApp service runs (no real connect/disconnect/send).
 *  4. STAFF WHATSAPP READ ALLOWED: read-only status endpoint stays available to billing
 *     staff.
 *  5. STAFF IMPORT/EXPORT DENIALS: upload, session preview/post, and dataset export are
 *     denied without the module permission (covers the never-called getImportPermission
 *     helper path).
 *  6. STAFF CROSS-MODULE PREVIEW DENIALS: payments/parties/purchases number previews are
 *     denied to a sales-only role.
 *  7. ZERO-PERMISSION USER: every guarded surface denies, including the godown
 *     main-warehouse stock lookup.
 *  8. MANAGER READ POSITIVES: a MANAGER (holds admin:manage_settings) can use read-only
 *     WhatsApp status/settings. No connect/send is exercised for any actor.
 *  9. SUPER ADMIN READ PATHS + SEARCH VISIBILITY: read-only WhatsApp status and a
 *     read-only dataset export succeed; global search returns a synthetic party for the
 *     Super Admin while the zero-permission user does not see it (req.user.isSuperAdmin
 *     fix).
 *
 * Requires: API server running on 127.0.0.1:3000 against the isolated test database
 * (same harness as tenantIsolationUserAccess.test.ts), with a test-only JWT_SECRET set.
 * Creates runId-suffixed synthetic tenants/users; touches no production-named business.
 * All fixture credentials are local to this file and never leave the isolated test run.
 */

import { db, pool } from '../db/index.js';
import { roles, permissions } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';

const API_BASE = 'http://127.0.0.1:3000';

export interface PermissionEnforcementResult {
  stepNumber: number;
  name: string;
  status: 'PASS' | 'FAIL';
  evidence: string;
}

export const verificationMatrix: PermissionEnforcementResult[] = [];

function recordResult(stepNumber: number, name: string, passed: boolean, evidence: string) {
  const status: 'PASS' | 'FAIL' = passed ? 'PASS' : 'FAIL';
  verificationMatrix.push({ stepNumber, name, status, evidence });
  const color = passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  [ITEM ${stepNumber.toString().padStart(2, '0')}] ${name}: ${color} -> ${evidence}`);
  if (!passed) {
    throw new Error(`Item ${stepNumber} Failed: ${name} -> ${evidence}`);
  }
}

async function apiRequest(endpoint: string, options: {
  method?: string;
  token?: string;
  businessId?: string;
  body?: any;
} = {}): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.businessId) headers['X-Business-Id'] = options.businessId;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON (e.g. xlsx buffer) */ }
  return { status: res.status, data };
}

async function login(username: string, password: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data: any = await res.json().catch(() => null);
  if (res.status === 200 && data?.token) {
    return data.token as string;
  }
  return null;
}

export async function runPermissionEnforcementVerification() {
  const runId = Math.random().toString(36).substring(2, 9);
  const client = await pool.connect();

  try {
    console.log('Setting up synthetic tenant for Permission Enforcement suite...');

    // ---------- Setup ----------
    const bizRes = await client.query(
      `INSERT INTO businesses (name, trade_name, business_type, status, gstin, pan, phone, email,
        address_line1, city, state, state_code, pincode)
       VALUES ($1, $1, 'MAIN', 'ACTIVE', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name`,
      [
        `PE Main ${runId}`,
        `27PE${runId.slice(0, 5)}1Z1`.slice(0, 15),
        `PE${runId.slice(0, 5)}`.slice(0, 10),
        '9876500000',
        `pe_main_${runId}@example.com`,
        '100 Industrial Estate', 'Mumbai', 'Maharashtra', '27', '400001',
      ]
    );
    const mainBiz = bizRes.rows[0] as { id: string; name: string };

    const [managerRole] = await db.select().from(roles).where(eq(roles.code, 'MANAGER')).limit(1);
    if (!managerRole) throw new Error('MANAGER role not seeded');

    // Custom sales-only staff role
    const staffPermRows = await db.select().from(permissions).where(inArray(permissions.code, ['sales:view', 'sales:create']));
    if (staffPermRows.length !== 2) throw new Error('sales:view/sales:create permissions not seeded');
    const staffRoleRes = await client.query(
      `INSERT INTO roles (business_id, name, code, description, is_system) VALUES ($1, $2, $3, 'PE staff role', false) RETURNING id`,
      [mainBiz.id, `PE Staff Role ${runId}`, `PE_STAFF_${runId.toUpperCase()}`]
    );
    const staffRoleId = staffRoleRes.rows[0].id as string;
    for (const p of staffPermRows) {
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [staffRoleId, p.id]);
    }

    // Custom zero-permission role
    const zeroRoleRes = await client.query(
      `INSERT INTO roles (business_id, name, code, description, is_system) VALUES ($1, $2, $3, 'PE zero role', false) RETURNING id`,
      [mainBiz.id, `PE Zero Role ${runId}`, `PE_ZERO_${runId.toUpperCase()}`]
    );
    const zeroRoleId = zeroRoleRes.rows[0].id as string;

    const PASSWORD = 'PePass@123';
    const passwordHash = await hashPassword(PASSWORD);
    let mobileCounter = 0;
    const mkUser = async (username: string, roleId: string, isSuperAdmin: boolean) => {
      const mobile = `985${runId.slice(0, 5)}${String(mobileCounter++).padStart(4, '0')}`; // users.mobile is UNIQUE
      const r = await client.query(
        `INSERT INTO users (username, email, mobile, full_name, password_hash, is_super_admin, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE') RETURNING id`,
        [username, `${username}@example.com`, mobile, `PE ${username}`, passwordHash, isSuperAdmin]
      );
      const userId = r.rows[0].id as string;
      await client.query(
        `INSERT INTO user_business_access (user_id, business_id, is_default) VALUES ($1, $2, true)`,
        [userId, mainBiz.id]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, business_id, role_id) VALUES ($1, $2, $3)`,
        [userId, mainBiz.id, roleId]
      );
      return { id: userId, username };
    };

    const staffUser = await mkUser(`pe_staff_${runId}`, staffRoleId, false);
    const zeroUser = await mkUser(`pe_zero_${runId}`, zeroRoleId, false);
    const managerUser = await mkUser(`pe_manager_${runId}`, managerRole.id, false);
    const superUser = await mkUser(`pe_super_${runId}`, managerRole.id, true);

    // Synthetic party for search-visibility checks
    await client.query(
      `INSERT INTO parties (business_id, party_code, name, party_type, status)
       VALUES ($1, $2, $3, 'CUSTOMER', 'ACTIVE')`,
      [mainBiz.id, `PEP${runId.slice(0, 6)}`, `PE Search Party ${runId}`]
    );

    // Synthetic import session (type PURCHASE) owned by this business
    const sessionRes = await client.query(
      `INSERT INTO import_sessions (business_id, import_type, file_name, file_size, status)
       VALUES ($1, 'PURCHASE', $2, 0, 'UPLOADED') RETURNING id`,
      [mainBiz.id, `pe-session-${runId}.xlsx`]
    );
    const sessionId = sessionRes.rows[0].id as string;

    console.log(`Provisioned: ${mainBiz.name}\n`);

    // -------------------------------------------------------------
    console.log('--- ITEM 1: Real credential login for all fixture users ---');
    const staffToken = await login(staffUser.username, PASSWORD);
    const zeroToken = await login(zeroUser.username, PASSWORD);
    const managerToken = await login(managerUser.username, PASSWORD);
    const superToken = await login(superUser.username, PASSWORD);
    recordResult(
      1,
      'REAL CREDENTIAL LOGIN',
      Boolean(staffToken && zeroToken && managerToken && superToken),
      `staff: ${!!staffToken}, zero-perm: ${!!zeroToken}, manager: ${!!managerToken}, superadmin: ${!!superToken}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 2: Staff sales-only positives ---');
    const staffOrders = await apiRequest('/api/sales/orders', { token: staffToken!, businessId: mainBiz.id });
    const staffPreview = await apiRequest('/api/sales/orders/number-preview', { token: staffToken!, businessId: mainBiz.id });
    recordResult(
      2,
      'STAFF SALES POSITIVES',
      staffOrders.status === 200 && staffPreview.status === 200,
      `orders list -> ${staffOrders.status}, number-preview -> ${staffPreview.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 3: Staff WhatsApp write denials (pre-service middleware) ---');
    const waConnect = await apiRequest('/api/whatsapp/connect', { method: 'POST', token: staffToken!, businessId: mainBiz.id });
    const waSettings = await apiRequest('/api/whatsapp/settings', { method: 'PUT', token: staffToken!, businessId: mainBiz.id, body: { autoSendInvoice: true } });
    const waSend = await apiRequest('/api/whatsapp/send-invoice', { method: 'POST', token: staffToken!, businessId: mainBiz.id, body: { invoiceId: '00000000-0000-0000-0000-000000000000' } });
    const waTest = await apiRequest('/api/whatsapp/test-connection', { method: 'POST', token: staffToken!, businessId: mainBiz.id });
    recordResult(
      3,
      'STAFF WHATSAPP WRITE DENIALS',
      waConnect.status === 403 && waSettings.status === 403 && waSend.status === 403 && waTest.status === 403,
      `connect -> ${waConnect.status}, settings PUT -> ${waSettings.status}, send-invoice -> ${waSend.status}, test-connection -> ${waTest.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 4: Staff WhatsApp read allowed ---');
    const waStatus = await apiRequest('/api/whatsapp/status', { token: staffToken!, businessId: mainBiz.id });
    recordResult(
      4,
      'STAFF WHATSAPP READ ALLOWED',
      waStatus.status === 200,
      `GET /api/whatsapp/status -> ${waStatus.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 5: Staff import/export denials ---');
    const impUpload = await apiRequest('/api/imports/upload', {
      method: 'POST',
      token: staffToken!,
      businessId: mainBiz.id,
      body: { importType: 'OPENING_STOCK', rows: [{ item: 'x' }], fileName: 'pe.xlsx' },
    });
    const impPreview = await apiRequest(`/api/imports/${sessionId}/preview`, { token: staffToken!, businessId: mainBiz.id });
    const impPost = await apiRequest(`/api/imports/${sessionId}/post`, { method: 'POST', token: staffToken!, businessId: mainBiz.id });
    const exportInv = await apiRequest('/api/exports/INVENTORY', { token: staffToken!, businessId: mainBiz.id });
    recordResult(
      5,
      'STAFF IMPORT/EXPORT DENIALS',
      impUpload.status === 403 && impPreview.status === 403 && impPost.status === 403 && exportInv.status === 403,
      `upload OPENING_STOCK -> ${impUpload.status}, session preview -> ${impPreview.status}, session post -> ${impPost.status}, export INVENTORY -> ${exportInv.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 6: Staff cross-module number-preview denials ---');
    const payPreview = await apiRequest('/api/payments/number-preview', { token: staffToken!, businessId: mainBiz.id });
    const partyPreview = await apiRequest('/api/parties/code-preview', { token: staffToken!, businessId: mainBiz.id });
    const purPreview = await apiRequest('/api/purchases/invoices/number-preview', { token: staffToken!, businessId: mainBiz.id });
    recordResult(
      6,
      'STAFF CROSS-MODULE PREVIEW DENIALS',
      payPreview.status === 403 && partyPreview.status === 403 && purPreview.status === 403,
      `payments -> ${payPreview.status}, parties -> ${partyPreview.status}, purchases -> ${purPreview.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 7: Zero-permission user denials ---');
    const zeroOrders = await apiRequest('/api/sales/orders', { token: zeroToken!, businessId: mainBiz.id });
    const zeroLookup = await apiRequest('/api/godowns/main-warehouse/stock-lookup', { token: zeroToken!, businessId: mainBiz.id });
    const zeroWa = await apiRequest('/api/whatsapp/status', { token: zeroToken!, businessId: mainBiz.id });
    const zeroPreview = await apiRequest('/api/sales/orders/number-preview', { token: zeroToken!, businessId: mainBiz.id });
    recordResult(
      7,
      'ZERO-PERMISSION DENIALS',
      zeroOrders.status === 403 && zeroLookup.status === 403 && zeroWa.status === 403 && zeroPreview.status === 403,
      `orders -> ${zeroOrders.status}, stock-lookup -> ${zeroLookup.status}, whatsapp status -> ${zeroWa.status}, sales preview -> ${zeroPreview.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 8: Manager read-only WhatsApp positives ---');
    const mgrWaStatus = await apiRequest('/api/whatsapp/status', { token: managerToken!, businessId: mainBiz.id });
    const mgrWaSettings = await apiRequest('/api/whatsapp/settings', { token: managerToken!, businessId: mainBiz.id });
    recordResult(
      8,
      'MANAGER WHATSAPP READ POSITIVES',
      mgrWaStatus.status === 200 && mgrWaSettings.status === 200,
      `status -> ${mgrWaStatus.status}, settings -> ${mgrWaSettings.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 9: Super Admin read paths + search visibility ---');
    const superWaStatus = await apiRequest('/api/whatsapp/status', { token: superToken!, businessId: mainBiz.id });
    const superExport = await apiRequest('/api/exports/PARTIES', { token: superToken!, businessId: mainBiz.id });
    const superSearch = await apiRequest(`/api/search?q=${encodeURIComponent(`PE Search Party ${runId}`)}`, { token: superToken!, businessId: mainBiz.id });
    const zeroSearch = await apiRequest(`/api/search?q=${encodeURIComponent(`PE Search Party ${runId}`)}`, { token: zeroToken!, businessId: mainBiz.id });
    const superPartyCount = (superSearch.data?.parties || []).length;
    const zeroPartyCount = (zeroSearch.data?.parties || []).length;
    recordResult(
      9,
      'SUPER ADMIN READ PATHS + SEARCH VISIBILITY',
      superWaStatus.status === 200 && superExport.status === 200 && superPartyCount >= 1 && zeroPartyCount === 0,
      `whatsapp status -> ${superWaStatus.status}, export PARTIES -> ${superExport.status}, super search parties: ${superPartyCount}, zero-perm search parties: ${zeroPartyCount}`
    );

    // User-requested sales+purchase role, in addition to the sales-only negative fixture.
    const bothUser = await mkUser(`pe_both_${runId}`, staffRoleId, false);
    await client.query(`UPDATE users SET user_permissions_override='{"purchase:view":true,"purchase:create":true}' WHERE id=$1`,[bothUser.id]);
    const bothToken = await login(bothUser.username, PASSWORD);
    const allowedPaths=['/api/sales/orders','/api/sales/orders/number-preview','/api/purchases/orders','/api/purchases/invoices/number-preview'];
    const allowed=[];for(const path of allowedPaths)allowed.push((await apiRequest(path,{token:bothToken!,businessId:mainBiz.id})).status);
    const deniedPaths=['/api/users','/api/godowns','/api/godowns/stock/balance','/api/payments/number-preview','/api/exports/INVENTORY'];
    const denied=[];for(const path of deniedPaths)denied.push((await apiRequest(path,{token:bothToken!,businessId:mainBiz.id})).status);
    const settingsDenied=await apiRequest('/api/businesses/settings',{method:'PUT',token:bothToken!,businessId:mainBiz.id,body:{config:{autoSendOnSave:true}}});
    const sendDenied=await apiRequest('/api/whatsapp/send-invoice',{method:'POST',token:bothToken!,businessId:mainBiz.id,body:{invoiceId:'00000000-0000-0000-0000-000000000000'}});
    recordResult(10,'SALES+PURCHASE STAFF BOUNDARY',Boolean(bothToken)&&allowed.every(s=>s===200)&&denied.every(s=>s===403)&&settingsDenied.status===403&&sendDenied.status===403,`allowed ${allowed.join('/')}; forbidden ${denied.join('/')}; settings/send ${settingsDenied.status}/${sendDenied.status}`);

    console.log('\n============================================================');
    console.log('PERMISSION ENFORCEMENT — FINAL VERIFICATION MATRIX');
    console.log('============================================================');
    console.table(
      verificationMatrix.map(m => ({
        Item: m.stepNumber,
        Verification: m.name,
        Status: m.status,
        Details: m.evidence.slice(0, 65),
      }))
    );
    console.log('============================================================\n');

    return verificationMatrix;
  } finally {
    client.release();
  }
}

// Execute when run via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runPermissionEnforcementVerification()
    .then(() => {
      console.log('Permission Enforcement verification completed successfully!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Permission Enforcement verification FAILED:', err.message);
      process.exit(1);
    });
}
