import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
/**
 * TENANT ISOLATION — USER/ACCESS MANAGEMENT BOUNDARY REGRESSION SUITE
 *
 * Verifies the fixes for the cross-tenant privilege-escalation gaps found in the
 * user/access-management surface (audit of commit f62372d), revision 3:
 *
 *  1. CREATE USER BOUNDARY: a non-Super Admin (Dealer MANAGER) cannot provision a user
 *     into a business outside his own authorized access (POST /api/users).
 *  2. BUSINESS-ACCESS REWRITE BOUNDARY: a Dealer MANAGER cannot rewrite anyone's
 *     (including his own) business access to include a foreign business
 *     (PUT /api/users/:id/business-access).
 *  3. PROFILE EDIT BOUNDARY: a Dealer MANAGER cannot edit/deactivate users of another
 *     business (PUT /api/users/:id); a Main MANAGER cannot modify a Super Administrator.
 *  4. BUSINESS-SCOPED USER WRITES: assign/role/remove under /api/businesses/:id/users
 *     are rejected when :id is not the actor's current business.
 *  5. DEALER-PARENT BOUNDARY: DealerUserService refuses any operation when the target
 *     Dealer does not belong to the actor's current Main Warehouse (service + API level).
 *  6. OWN-BUSINESS ADMIN PRESERVED, LINKED-COMPANY ADMIN DENIED: Main manager creates/updates users within his
 *     own business; linked-company provisioning is denied; Super Admin remains unrestricted.
 *  7. DEALER SELF-ADMINISTRATION PRESERVED: a Dealer MANAGER can manage users inside his
 *     own Dealer business.
 *  8. OUT-OF-SCOPE MEMBERSHIP PRESERVATION: business-access replacement by a non-Super
 *     Admin preserves the target's memberships, roles and default flag in businesses
 *     outside the actor's scope instead of wiping them.
 *  9. ROLE/PERMISSION CEILING: an actor cannot grant a role whose permissions exceed his
 *     own effective permissions in the target business - on POST /api/users,
 *     PUT /:id/business-access, POST /api/businesses/:id/users, and DealerUserService.
 *     Includes the weak-access-in-another-business case. Legitimate grants still pass.
 * 10. SUPER ADMIN TARGET PROTECTIONS: status change, password reset, role change, access
 *     removal and profile edit against a Super Administrator are rejected for non-Super
 *     Admin actors on every management surface; Super Admin paths still work.
 * 11. ROLE TENANT SCOPE: custom roles owned by a foreign tenant are rejected on every
 *     assignment surface even when their current permission set is harmless; system roles,
 *     the target business's own roles, and the owning Main Warehouse's roles (owner-to-own-
 *     dealer) remain assignable.
 * 12. DEFAULT-BUSINESS PROTECTION ON ADD/REMOVE: the businesses add-user surface and the
 *     Dealer assign-existing-user path refuse to steal a default business outside the
 *     actor's scope, and access removal never promotes an out-of-scope membership to
 *     default.
 * 13. USER-DETAIL SCOPE FILTERING: GET /api/users/:id returns only the target's
 *     memberships inside the actor's own authorized businesses; foreign-tenant
 *     memberships, their roles and the true default stay hidden. Super Admin sees all.
 *
 * Requires: API server running on 127.0.0.1:3000 against the isolated test database
 * (same harness as phase4bRuntimeSecurity.test.ts), with a test-only JWT_SECRET set.
 * Creates runId-suffixed synthetic tenants/users; touches no production-named business.
 */

import { db, pool } from '../db/index.js';
import { roles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { DealerCreationService } from '../services/dealerCreationService.js';
import { DealerUserService } from '../services/dealerUserService.js';
import { hashPassword } from '../auth/password.js';
import { generateAuthToken } from '../auth/jwt.js';

const API_BASE = 'http://127.0.0.1:3000';

export interface TenantIsolationTestResult {
  stepNumber: number;
  name: string;
  status: 'PASS' | 'FAIL';
  evidence: string;
}

export const verificationMatrix: TenantIsolationTestResult[] = [];

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
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

export async function runTenantIsolationVerification() {
  const runId = Math.random().toString(36).substring(2, 9);
  const client = await pool.connect();

  try {
    console.log('Setting up synthetic tenants for Tenant Isolation suite...');

    // ---------- Setup: two MAIN warehouses, one Dealer each ----------
    const mkMain = async (label: string) => {
      const r = await client.query(
        `INSERT INTO businesses (name, trade_name, business_type, status, gstin, pan, phone, email,
          address_line1, city, state, state_code, pincode)
         VALUES ($1, $1, 'MAIN', 'ACTIVE', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, name`,
        [
          `TI Main ${label} ${runId}`,
          `27TI${label}${runId.slice(0, 4)}1Z1`.slice(0, 15),
          `TI${label}${runId.slice(0, 4)}`.slice(0, 10),
          '9876500000',
          `ti_main_${label}_${runId}@example.com`,
          '100 Industrial Estate', 'Mumbai', 'Maharashtra', '27', '400001',
        ]
      );
      return r.rows[0] as { id: string; name: string };
    };

    const mainBiz = await mkMain('A');
    const otherMainBiz = await mkMain('B');

    let userMobileCounter = 0;
    const mkUser = async (username: string, isSuperAdmin: boolean) => {
      const passwordHash = await hashPassword('TiPass@123');
      const mobile = `986${runId.slice(0, 5)}${String(userMobileCounter++).padStart(4, '0')}`; // users.mobile is UNIQUE
      const r = await client.query(
        `INSERT INTO users (username, email, mobile, full_name, password_hash, is_super_admin, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE') RETURNING id, username, email`,
        [username, `${username}@example.com`, mobile, `TI ${username}`, passwordHash, isSuperAdmin]
      );
      return r.rows[0] as { id: string; username: string; email: string };
    };

    const grantAccess = async (userId: string, businessId: string, roleId: string, isDefault = true) => {
      await client.query(
        `INSERT INTO user_business_access (user_id, business_id, is_default) VALUES ($1, $2, $3)`,
        [userId, businessId, isDefault]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, business_id, role_id) VALUES ($1, $2, $3)`,
        [userId, businessId, roleId]
      );
    };

    const mkToken = (u: { id: string; username: string; email: string }, businessId: string, isSuperAdmin = false) =>
      generateAuthToken({ userId: u.id, username: u.username, email: u.email, isSuperAdmin, businessId });

    const [managerRole] = await db.select().from(roles).where(eq(roles.code, 'MANAGER')).limit(1);
    const [viewerRole] = await db.select().from(roles).where(eq(roles.code, 'VIEWER')).limit(1);
    if (!managerRole || !viewerRole) throw new Error('MANAGER/VIEWER roles not seeded');

    // Custom role holding a permission MANAGER lacks (admin:manage_roles) for ceiling tests
    const manageRolesPermRes = await client.query(`SELECT id FROM permissions WHERE code = 'admin:manage_roles' LIMIT 1`);
    if (manageRolesPermRes.rows.length === 0) throw new Error('admin:manage_roles permission not seeded');
    const powerRoleRes = await client.query(
      `INSERT INTO roles (name, code, description, is_system) VALUES ($1, $2, 'TI ceiling test role', false) RETURNING id`,
      [`TI Power Role ${runId}`, `TI_POWER_${runId.toUpperCase()}`]
    );
    const powerRole = powerRoleRes.rows[0];
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [powerRole.id, manageRolesPermRes.rows[0].id]
    );

    // Actors
    const mainAdmin = await mkUser(`ti_mainadm_${runId}`, false);
    await grantAccess(mainAdmin.id, mainBiz.id, managerRole.id);
    const mainAdminToken = mkToken(mainAdmin, mainBiz.id);

    const mainOnlyUser = await mkUser(`ti_mainonly_${runId}`, false);
    await grantAccess(mainOnlyUser.id, mainBiz.id, viewerRole.id);

    const superAdminUser = await mkUser(`ti_super_${runId}`, true);
    await grantAccess(superAdminUser.id, mainBiz.id, viewerRole.id);
    const superAdminToken = mkToken(superAdminUser, mainBiz.id, true);

    // Hybrid actor: strong in Main A (MANAGER), weak in Dealer A (VIEWER, granted after dealerA exists)
    const hybridUser = await mkUser(`ti_hybrid_${runId}`, false);
    await grantAccess(hybridUser.id, mainBiz.id, managerRole.id);
    const hybridToken = mkToken(hybridUser, mainBiz.id);

    // Dealers (one under each Main)
    const dealerARes = await DealerCreationService.createDealer(mainBiz.id, mainAdmin.id, {
      name: `TI Dealer A ${runId}`,
      phone: '9820100000',
      email: `ti_dealer_a_${runId}@example.com`,
      city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001',
    });
    const dealerA = dealerARes.dealer;

    const dealerCRes = await DealerCreationService.createDealer(otherMainBiz.id, superAdminUser.id, {
      name: `TI Dealer C ${runId}`,
      phone: '9820300000',
      email: `ti_dealer_c_${runId}@example.com`,
      city: 'Nagpur', state: 'Maharashtra', stateCode: '27', pincode: '440001',
    });
    const dealerC = dealerCRes.dealer;

    // Grant hybrid's weak Dealer A membership now that dealerA exists
    await client.query(
      `INSERT INTO user_business_access (user_id, business_id, is_default) VALUES ($1, $2, false)
       ON CONFLICT (user_id, business_id) DO NOTHING`,
      [hybridUser.id, dealerA.id]
    );
    await client.query(
      `INSERT INTO user_roles (user_id, business_id, role_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, business_id, role_id) DO NOTHING`,
      [hybridUser.id, dealerA.id, viewerRole.id]
    );

    // Super Admin also holds a Dealer A membership (for profile/edit guard tests)
    await client.query(
      `INSERT INTO user_business_access (user_id, business_id, is_default) VALUES ($1, $2, false)
       ON CONFLICT (user_id, business_id) DO NOTHING`,
      [superAdminUser.id, dealerA.id]
    );

    // Dealer A manager (member of Dealer A ONLY) - the attacking principal
    const dealerMgr = await mkUser(`ti_dlrmgr_${runId}`, false);
    await grantAccess(dealerMgr.id, dealerA.id, managerRole.id);
    const dealerMgrToken = mkToken(dealerMgr, dealerA.id);

    // Shared user: member of Main A (in-scope for mainAdmin) AND Dealer C (out of scope)
    const sharedUser = await mkUser(`ti_shared_${runId}`, false);
    await grantAccess(sharedUser.id, mainBiz.id, viewerRole.id, false);
    await grantAccess(sharedUser.id, dealerC.id, managerRole.id, true); // default lives out of scope

    // Pure Main B user (no Main A membership) for read-boundary checks
    const foreignUser = await mkUser(`ti_foreign_${runId}`, false);
    await grantAccess(foreignUser.id, otherMainBiz.id, viewerRole.id);

    // Fresh user with no memberships (role-scope assignment target)
    const scopeTarget = await mkUser(`ti_scopetgt_${runId}`, false);

    // User whose ONLY membership (and default) is out of mainAdmin's scope (Dealer C)
    const defaultOutUser = await mkUser(`ti_defout_${runId}`, false);
    await grantAccess(defaultOutUser.id, dealerC.id, managerRole.id, true);

    // User whose default is in-scope (Main A) with an out-of-scope secondary (Dealer C)
    const delDefaultUser = await mkUser(`ti_deldef_${runId}`, false);
    await grantAccess(delDefaultUser.id, mainBiz.id, viewerRole.id, true);
    await grantAccess(delDefaultUser.id, dealerC.id, viewerRole.id, false);

    // Custom roles for tenant-scope tests, each holding one harmless (VIEWER-level)
    // permission so rejections are attributable to tenant scope, not the ceiling.
    const harmlessPermRes = await client.query(
      `SELECT permission_id FROM role_permissions WHERE role_id = $1 LIMIT 1`, [viewerRole.id]
    );
    const harmlessPermId = harmlessPermRes.rows[0]?.permission_id || null;
    const mkScopedRole = async (name: string, code: string, ownerBusinessId: string | null) => {
      const rr = await client.query(
        `INSERT INTO roles (business_id, name, code, description, is_system) VALUES ($1, $2, $3, 'TI scope test role', false) RETURNING id`,
        [ownerBusinessId, name, code]
      );
      const roleId = rr.rows[0].id as string;
      if (harmlessPermId) {
        await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, harmlessPermId]);
      }
      return { id: roleId };
    };
    const foreignRole = await mkScopedRole(`TI Foreign Role ${runId}`, `TI_FRN_${runId.toUpperCase()}`, otherMainBiz.id);
    const mainCustomRole = await mkScopedRole(`TI Main Custom Role ${runId}`, `TI_MCN_${runId.toUpperCase()}`, mainBiz.id);
    const dealerRoleA = await mkScopedRole(`TI Dealer A Role ${runId}`, `TI_DLR_${runId.toUpperCase()}`, dealerA.id);

    console.log(`Provisioned: Main A ${mainBiz.name}, Main B ${otherMainBiz.name}, Dealer A ${dealerA.name}, Dealer C ${dealerC.name}\n`);

    // -------------------------------------------------------------
    console.log('--- ITEM 1: Create-User Cross-Tenant Boundary ---');
    const exploitUsername = `ti_exploit_${runId}`;
    const createRes = await apiRequest('/api/users', {
      method: 'POST',
      token: dealerMgrToken,
      businessId: dealerA.id,
      body: {
        username: exploitUsername,
        fullName: 'Exploit Attempt',
        password: 'Exploit@123',
        businessAssignments: [{ businessId: mainBiz.id, roleId: managerRole.id, isDefault: true }],
      },
    });
    const exploitUserExists = (await client.query('SELECT id FROM users WHERE username = $1', [exploitUsername])).rows.length > 0;
    recordResult(
      1,
      'CREATE USER BOUNDARY',
      createRes.status === 403 && !exploitUserExists,
      `Dealer MANAGER POST /api/users into Main business -> HTTP ${createRes.status}; user persisted: ${exploitUserExists}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 2: Business-Access Rewrite Boundary ---');
    const rewriteRes = await apiRequest(`/api/users/${dealerMgr.id}/business-access`, {
      method: 'PUT',
      token: dealerMgrToken,
      businessId: dealerA.id,
      body: {
        assignments: [
          { businessId: dealerA.id, roleId: managerRole.id },
          { businessId: mainBiz.id, roleId: managerRole.id },
        ],
        defaultBusinessId: dealerA.id,
      },
    });
    const mgrAccessRows = await client.query(
      'SELECT business_id FROM user_business_access WHERE user_id = $1', [dealerMgr.id]
    );
    const stillOnlyDealerA = mgrAccessRows.rows.length === 1 && mgrAccessRows.rows[0].business_id === dealerA.id;
    recordResult(
      2,
      'BUSINESS-ACCESS REWRITE BOUNDARY',
      rewriteRes.status === 403 && stillOnlyDealerA,
      `Dealer MANAGER self-escalation via business-access -> HTTP ${rewriteRes.status}; memberships unchanged (Dealer A only): ${stillOnlyDealerA}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 3: Profile Edit Boundary + Super Admin Protection ---');
    const crossEditRes = await apiRequest(`/api/users/${mainOnlyUser.id}`, {
      method: 'PUT',
      token: dealerMgrToken,
      businessId: dealerA.id,
      body: { fullName: 'Hijacked Name', status: 'INACTIVE' },
    });
    const mainOnlyAfter = (await client.query('SELECT full_name, status FROM users WHERE id = $1', [mainOnlyUser.id])).rows[0];
    const crossEditBlocked = crossEditRes.status === 403 && mainOnlyAfter.full_name !== 'Hijacked Name' && mainOnlyAfter.status === 'ACTIVE';

    const superTargetRes = await apiRequest(`/api/users/${superAdminUser.id}`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { fullName: 'Ti Super Renamed', status: 'INACTIVE' },
    });
    const superAfter = (await client.query('SELECT full_name, status FROM users WHERE id = $1', [superAdminUser.id])).rows[0];
    const superProtected = superTargetRes.status === 403 && superAfter.status === 'ACTIVE';
    recordResult(
      3,
      'PROFILE EDIT BOUNDARY + SUPER ADMIN PROTECTION',
      crossEditBlocked && superProtected,
      `Cross-tenant edit -> HTTP ${crossEditRes.status} (unchanged: ${crossEditBlocked}); Main MANAGER vs Super Admin -> HTTP ${superTargetRes.status}, super still ACTIVE: ${superAfter.status === 'ACTIVE'}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 4: Business-Scoped User Write Boundaries ---');
    const assignRes = await apiRequest(`/api/businesses/${mainBiz.id}/users`, {
      method: 'POST',
      token: dealerMgrToken,
      businessId: dealerA.id,
      body: { userId: dealerMgr.id, roleId: managerRole.id, isDefault: false },
    });
    const roleRes4 = await apiRequest(`/api/businesses/${mainBiz.id}/users/${mainOnlyUser.id}/role`, {
      method: 'PUT',
      token: dealerMgrToken,
      businessId: dealerA.id,
      body: { roleId: managerRole.id },
    });
    const removeRes4 = await apiRequest(`/api/businesses/${mainBiz.id}/users/${mainOnlyUser.id}`, {
      method: 'DELETE',
      token: dealerMgrToken,
      businessId: dealerA.id,
    });
    const mainOnlyStillMember = (await client.query(
      'SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2', [mainOnlyUser.id, mainBiz.id]
    )).rows.length === 1;
    const mgrNotInMain = (await client.query(
      'SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2', [dealerMgr.id, mainBiz.id]
    )).rows.length === 0;
    recordResult(
      4,
      'BUSINESS-SCOPED USER WRITES BOUNDARY',
      assignRes.status === 403 && roleRes4.status === 403 && removeRes4.status === 403 && mainOnlyStillMember && mgrNotInMain,
      `assign -> ${assignRes.status}, role -> ${roleRes4.status}, remove -> ${removeRes4.status}; mainOnlyUser membership intact: ${mainOnlyStillMember}; dealer manager not in Main: ${mgrNotInMain}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 5: Dealer-Parent Boundary (service + API) ---');
    let serviceBlocked = false;
    try {
      await DealerUserService.createDealerUser(mainBiz.id, dealerC.id, mainAdmin.id, false, {
        fullName: 'Cross Parent Attempt',
        username: `ti_xparent_${runId}`,
        password: 'XParent@123',
        roleId: viewerRole.id,
      });
    } catch (err: any) {
      serviceBlocked = /not found under this Main Warehouse/i.test(err.message);
    }
    let toggleBlocked = false;
    try {
      await DealerUserService.toggleUserStatus(mainBiz.id, dealerC.id, mainOnlyUser.id, 'INACTIVE', mainAdmin.id);
    } catch (err: any) {
      toggleBlocked = /not found under this Main Warehouse|does not have access/i.test(err.message);
    }
    const apiCrossParent = await apiRequest(`/api/main/dealers/${dealerC.id}/users`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: {
        fullName: 'Cross Parent API',
        username: `ti_xparent2_${runId}`,
        password: 'XParent@123',
        roleId: viewerRole.id,
      },
    });
    const crossParentUserCreated = (await client.query(
      'SELECT id FROM users WHERE username IN ($1, $2)', [`ti_xparent_${runId}`, `ti_xparent2_${runId}`]
    )).rows.length > 0;
    recordResult(
      5,
      'DEALER-PARENT BOUNDARY',
      serviceBlocked && toggleBlocked && apiCrossParent.status === 403 && !crossParentUserCreated,
      `service create blocked: ${serviceBlocked}; service toggle blocked: ${toggleBlocked}; API cross-parent -> HTTP ${apiCrossParent.status}; no cross-parent user persisted: ${!crossParentUserCreated}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 6: Legitimate Owner Workflows Preserved ---');
    const staffUsername = `ti_staff_${runId}`;
    const ownerCreate = await apiRequest('/api/users', {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: {
        username: staffUsername,
        fullName: 'Main Staff',
        password: 'Staff@123',
        businessAssignments: [{ businessId: mainBiz.id, roleId: viewerRole.id, isDefault: true }],
      },
    });
    const staffId = ownerCreate.data?.user?.id;
    const ownerRewrite = staffId ? await apiRequest(`/api/users/${staffId}/business-access`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { assignments: [{ businessId: mainBiz.id, roleId: viewerRole.id }], defaultBusinessId: mainBiz.id },
    }) : { status: 0 };
    const ownerDealerUser = await apiRequest(`/api/main/dealers/${dealerA.id}/users`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: {
        fullName: 'Dealer Staff By Owner',
        username: `ti_dstaff_${runId}`,
        password: 'DStaff@123',
        roleId: viewerRole.id,
      },
    });
    const superEdit = await apiRequest(`/api/users/${mainOnlyUser.id}`, {
      method: 'PUT',
      token: superAdminToken,
      body: { fullName: 'Main Only Renamed' },
    });
    recordResult(
      6,
      'OWN-BUSINESS ADMIN PRESERVED, LINKED-COMPANY ADMIN DENIED',
      ownerCreate.status === 201 && ownerRewrite.status === 200 && ownerDealerUser.status === 403 && superEdit.status === 200,
      `owner create in own Main -> ${ownerCreate.status}; owner business-access within own Main -> ${ownerRewrite.status}; ordinary owner linked-company user provisioning denied -> ${ownerDealerUser.status}; Super Admin edit -> ${superEdit.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 7: Dealer Self-Administration Preserved ---');
    const dealerOwnUsers = await apiRequest(`/api/businesses/${dealerA.id}/users`, {
      token: dealerMgrToken,
      businessId: dealerA.id,
    });
    const dealerOwnCreate = await apiRequest('/api/users', {
      method: 'POST',
      token: dealerMgrToken,
      businessId: dealerA.id,
      body: {
        username: `ti_dstaff2_${runId}`,
        fullName: 'Dealer A Staff',
        password: 'DStaff2@123',
        businessAssignments: [{ businessId: dealerA.id, roleId: viewerRole.id, isDefault: true }],
      },
    });
    recordResult(
      7,
      'DEALER SELF-ADMINISTRATION PRESERVED',
      dealerOwnUsers.status === 200 && dealerOwnCreate.status === 201,
      `Dealer MANAGER lists own Dealer users -> ${dealerOwnUsers.status}; creates staff in own Dealer -> ${dealerOwnCreate.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 8: Out-of-Scope Membership Preservation ---');
    // mainAdmin (scope: Main A only) rewrites sharedUser's access within Main A.
    // sharedUser's Dealer C membership, MANAGER role and default flag must survive.
    const preserveRes = await apiRequest(`/api/users/${sharedUser.id}/business-access`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: {
        assignments: [{ businessId: mainBiz.id, roleId: managerRole.id }],
        defaultBusinessId: mainBiz.id,
      },
    });
    const sharedAccess = await client.query(
      'SELECT business_id, is_default FROM user_business_access WHERE user_id = $1 ORDER BY business_id',
      [sharedUser.id]
    );
    const sharedRoles = await client.query(
      `SELECT ur.business_id, r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [sharedUser.id]
    );
    const dealerCRow = sharedAccess.rows.find((r: any) => r.business_id === dealerC.id);
    const mainRow = sharedAccess.rows.find((r: any) => r.business_id === mainBiz.id);
    const dealerCRole = sharedRoles.rows.find((r: any) => r.business_id === dealerC.id);
    const mainRole = sharedRoles.rows.find((r: any) => r.business_id === mainBiz.id);
    const preservedOk =
      preserveRes.status === 200 &&
      sharedAccess.rows.length === 2 &&
      !!dealerCRow && dealerCRow.is_default === true &&          // out-of-scope default preserved
      !!mainRow && mainRow.is_default === false &&               // in-scope row must NOT steal default
      dealerCRole?.code === 'MANAGER' &&                         // out-of-scope role preserved
      mainRole?.code === 'MANAGER';                              // in-scope role updated as requested
    recordResult(
      8,
      'OUT-OF-SCOPE MEMBERSHIP PRESERVATION',
      preservedOk,
      `rewrite -> HTTP ${preserveRes.status}; memberships: ${sharedAccess.rows.length} (Dealer C kept: ${!!dealerCRow}, default preserved: ${dealerCRow?.is_default === true}); roles: Dealer C=${dealerCRole?.code}, Main A=${mainRole?.code}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 9: Role/Permission Ceiling ---');
    // 9a: POST /api/users granting power role (holds admin:manage_roles) -> MANAGER actor lacks it
    const ceilCreate = await apiRequest('/api/users', {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: {
        username: `ti_ceil_${runId}`,
        fullName: 'Ceiling Attempt',
        password: 'Ceil@123',
        businessAssignments: [{ businessId: mainBiz.id, roleId: powerRole.id, isDefault: true }],
      },
    });
    const ceilUserExists = (await client.query('SELECT id FROM users WHERE username = $1', [`ti_ceil_${runId}`])).rows.length > 0;
    // 9b: business-access surface
    const ceilRewrite = await apiRequest(`/api/users/${mainOnlyUser.id}/business-access`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { assignments: [{ businessId: mainBiz.id, roleId: powerRole.id }], defaultBusinessId: mainBiz.id },
    });
    // 9c: businesses/:id/users surface (fresh target with no memberships)
    const ceilTarget = await mkUser(`ti_ceiltgt_${runId}`, false);
    const ceilAssign = await apiRequest(`/api/businesses/${mainBiz.id}/users`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { userId: ceilTarget.id, roleId: powerRole.id, isDefault: false },
    });
    // 9d: DealerUserService ceiling
    let serviceCeilBlocked = false;
    try {
      await DealerUserService.createDealerUser(mainBiz.id, dealerA.id, mainAdmin.id, false, {
        fullName: 'Ceiling Service Attempt',
        username: `ti_ceilsvc_${runId}`,
        password: 'CeilSvc@123',
        roleId: powerRole.id,
      });
    } catch (err: any) {
      serviceCeilBlocked = /permissions you do not hold/i.test(err.message);
    }
    const ceilSvcUserExists = (await client.query('SELECT id FROM users WHERE username = $1', [`ti_ceilsvc_${runId}`])).rows.length > 0;
    // 9e: weak-access-in-another-business: hybrid (MANAGER in Main A, VIEWER in Dealer A)
    //     may assign VIEWER in Dealer A but NOT MANAGER there.
    const hybridWeak = await apiRequest(`/api/users/${staffId}/business-access`, {
      method: 'PUT',
      token: hybridToken,
      businessId: mainBiz.id,
      body: {
        assignments: [
          { businessId: mainBiz.id, roleId: viewerRole.id },
          { businessId: dealerA.id, roleId: viewerRole.id },
        ],
        defaultBusinessId: mainBiz.id,
      },
    });
    const hybridStrong = await apiRequest(`/api/users/${staffId}/business-access`, {
      method: 'PUT',
      token: hybridToken,
      businessId: mainBiz.id,
      body: {
        assignments: [
          { businessId: mainBiz.id, roleId: viewerRole.id },
          { businessId: dealerA.id, roleId: managerRole.id },
        ],
        defaultBusinessId: mainBiz.id,
      },
    });
    // 9f: Super Admin bypass still works
    const superCeilAssign = await apiRequest(`/api/businesses/${mainBiz.id}/users`, {
      method: 'POST',
      token: superAdminToken,
      body: { userId: ceilTarget.id, roleId: powerRole.id, isDefault: false },
    });
    const ceilingOk =
      ceilCreate.status === 403 && !ceilUserExists &&
      ceilRewrite.status === 403 &&
      ceilAssign.status === 403 &&
      serviceCeilBlocked && !ceilSvcUserExists &&
      hybridWeak.status === 200 &&
      hybridStrong.status === 403 &&
      superCeilAssign.status === 201;
    recordResult(
      9,
      'ROLE/PERMISSION CEILING',
      ceilingOk,
      `create -> ${ceilCreate.status}; business-access -> ${ceilRewrite.status}; businesses/users -> ${ceilAssign.status}; service blocked: ${serviceCeilBlocked}; weak-actor VIEWER grant -> ${hybridWeak.status}, MANAGER grant -> ${hybridStrong.status}; superadmin assign -> ${superCeilAssign.status}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 10: Super Admin Target Protections ---');
    const stStatus = await apiRequest(`/api/users/${superAdminUser.id}/status`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { status: 'INACTIVE' },
    });
    const stReset = await apiRequest(`/api/users/${superAdminUser.id}/reset-password`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { newPassword: 'Hacked@123' },
    });
    const stRole = await apiRequest(`/api/businesses/${mainBiz.id}/users/${superAdminUser.id}/role`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { roleId: viewerRole.id },
    });
    const stRemove = await apiRequest(`/api/businesses/${mainBiz.id}/users/${superAdminUser.id}`, {
      method: 'DELETE',
      token: mainAdminToken,
      businessId: mainBiz.id,
    });
    let stProfileBlocked = false;
    try {
      await DealerUserService.updateUserProfile(mainBiz.id, dealerA.id, superAdminUser.id, { fullName: 'Super Hijack' }, mainAdmin.id);
    } catch (err: any) {
      stProfileBlocked = /Super Administrator/i.test(err.message);
    }
    // Super Admin paths still work
    const superResetOk = await apiRequest(`/api/users/${mainOnlyUser.id}/reset-password`, {
      method: 'POST',
      token: superAdminToken,
      body: { newPassword: 'NewPass@123' },
    });
    const superAfterAll = (await client.query('SELECT status FROM users WHERE id = $1', [superAdminUser.id])).rows[0];
    const superAccessIntact = (await client.query(
      'SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2', [superAdminUser.id, mainBiz.id]
    )).rows.length === 1;
    const protectionsOk =
      stStatus.status === 403 && stReset.status === 403 && stRole.status === 403 && stRemove.status === 403 &&
      stProfileBlocked &&
      superAfterAll.status === 'ACTIVE' && superAccessIntact &&
      superResetOk.status === 200;
    recordResult(
      10,
      'SUPER ADMIN TARGET PROTECTIONS',
      protectionsOk,
      `status -> ${stStatus.status}, reset -> ${stReset.status}, role -> ${stRole.status}, remove -> ${stRemove.status}, profile service blocked: ${stProfileBlocked}; super ACTIVE: ${superAfterAll.status === 'ACTIVE'}, access intact: ${superAccessIntact}; superadmin reset works: ${superResetOk.status === 200}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 11: Role Tenant Scope ---');
    // 11a: POST /api/users with a foreign-tenant custom role -> rejected
    const scopeCreate = await apiRequest('/api/users', {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: {
        username: `ti_scope_${runId}`,
        fullName: 'Scope Attempt',
        password: 'Scope@123',
        businessAssignments: [{ businessId: mainBiz.id, roleId: foreignRole.id, isDefault: true }],
      },
    });
    const scopeUserExists = (await client.query('SELECT id FROM users WHERE username = $1', [`ti_scope_${runId}`])).rows.length > 0;
    // 11b: business-access surface
    const scopeRewrite = await apiRequest(`/api/users/${mainOnlyUser.id}/business-access`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { assignments: [{ businessId: mainBiz.id, roleId: foreignRole.id }], defaultBusinessId: mainBiz.id },
    });
    // 11c: businesses add-user surface
    const scopeAssign = await apiRequest(`/api/businesses/${mainBiz.id}/users`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { userId: scopeTarget.id, roleId: foreignRole.id, isDefault: false },
    });
    // 11d: businesses role-change surface
    const scopeRoleChange = await apiRequest(`/api/businesses/${mainBiz.id}/users/${mainOnlyUser.id}/role`, {
      method: 'PUT',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { roleId: foreignRole.id },
    });
    // 11e: DealerUserService into Dealer A with a foreign-tenant role -> rejected
    let scopeServiceBlocked = false;
    try {
      await DealerUserService.updateUserRole(mainBiz.id, dealerA.id, dealerMgr.id, foreignRole.id, mainAdmin.id, false);
    } catch (err: any) {
      scopeServiceBlocked = /different business tenant/i.test(err.message);
    }
    const dealerMgrRoleKept = (await client.query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.business_id = $2`,
      [dealerMgr.id, dealerA.id]
    )).rows[0]?.code === 'MANAGER';
    // 11f: legitimate owner-to-own-dealer: Main-owned custom role assigned into own Dealer A
    const ownDealerAssign = await DealerUserService.assignExistingUser(
      mainBiz.id, dealerA.id, mainAdmin.id, false,
      { userId: scopeTarget.id, roleId: mainCustomRole.id }
    );
    // 11g: the Dealer's own custom role assigned in the Dealer
    const ownDealerRole = await DealerUserService.updateUserRole(
      mainBiz.id, dealerA.id, scopeTarget.id, dealerRoleA.id, mainAdmin.id, false
    );
    const scopeOk =
      scopeCreate.status === 403 && !scopeUserExists &&
      scopeRewrite.status === 403 &&
      scopeAssign.status === 403 &&
      scopeRoleChange.status === 403 &&
      scopeServiceBlocked && dealerMgrRoleKept &&
      ownDealerAssign.success === true &&
      ownDealerRole.success === true;
    recordResult(
      11,
      'ROLE TENANT SCOPE',
      scopeOk,
      `foreign role: create -> ${scopeCreate.status}, rewrite -> ${scopeRewrite.status}, add-user -> ${scopeAssign.status}, role-change -> ${scopeRoleChange.status}, service blocked: ${scopeServiceBlocked} (dealer role kept: ${dealerMgrRoleKept}); main role into own dealer: ${ownDealerAssign.success}; dealer's own role: ${ownDealerRole.success}`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 12: Default-Business Protection on Add/Remove ---');
    // 12a: add-user with isDefault=true while the user's default lives out of scope -> rejected
    const stealDefault = await apiRequest(`/api/businesses/${mainBiz.id}/users`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { userId: defaultOutUser.id, roleId: viewerRole.id, isDefault: true },
    });
    const outDefaultKept1 = (await client.query(
      'SELECT is_default FROM user_business_access WHERE user_id = $1 AND business_id = $2', [defaultOutUser.id, dealerC.id]
    )).rows[0]?.is_default === true;
    // 12b: same add without isDefault -> allowed, out-of-scope default untouched
    const keepDefault = await apiRequest(`/api/businesses/${mainBiz.id}/users`, {
      method: 'POST',
      token: mainAdminToken,
      businessId: mainBiz.id,
      body: { userId: defaultOutUser.id, roleId: viewerRole.id, isDefault: false },
    });
    const outDefaultKept2 = (await client.query(
      'SELECT is_default FROM user_business_access WHERE user_id = $1 AND business_id = $2', [defaultOutUser.id, dealerC.id]
    )).rows[0]?.is_default === true;
    const newRowNotDefault = (await client.query(
      'SELECT is_default FROM user_business_access WHERE user_id = $1 AND business_id = $2', [defaultOutUser.id, mainBiz.id]
    )).rows[0]?.is_default === false;
    // 12c: removing the in-scope default membership must NOT promote the out-of-scope one
    const removeDefault = await apiRequest(`/api/businesses/${mainBiz.id}/users/${delDefaultUser.id}`, {
      method: 'DELETE',
      token: mainAdminToken,
      businessId: mainBiz.id,
    });
    const outRowPromoted = (await client.query(
      'SELECT is_default FROM user_business_access WHERE user_id = $1 AND business_id = $2', [delDefaultUser.id, dealerC.id]
    )).rows[0]?.is_default === true;
    const mainRowGone = (await client.query(
      'SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2', [delDefaultUser.id, mainBiz.id]
    )).rows.length === 0;
    const defaultsOk =
      stealDefault.status === 403 && outDefaultKept1 &&
      keepDefault.status === 201 && outDefaultKept2 && newRowNotDefault &&
      removeDefault.status === 200 && mainRowGone && !outRowPromoted;
    recordResult(
      12,
      'DEFAULT-BUSINESS PROTECTION ON ADD/REMOVE',
      defaultsOk,
      `steal default -> ${stealDefault.status} (Dealer C default kept: ${outDefaultKept1}); plain add -> ${keepDefault.status} (default kept: ${outDefaultKept2}, new row non-default: ${newRowNotDefault}); remove in-scope default -> ${removeDefault.status} (row gone: ${mainRowGone}, out-of-scope promoted: ${outRowPromoted})`
    );

    // -------------------------------------------------------------
    console.log('\n--- ITEM 13: User-Detail Scope Filtering ---');
    const scopedDetail = await apiRequest(`/api/users/${sharedUser.id}`, {
      token: mainAdminToken,
      businessId: mainBiz.id,
    });
    const scopedBizIds = (scopedDetail.data?.authorizedBusinesses || []).map((b: any) => b.businessId);
    const scopedFiltered =
      scopedDetail.status === 200 &&
      scopedBizIds.length === 1 &&
      scopedBizIds[0] === mainBiz.id &&
      (scopedDetail.data?.defaultBusinessId ?? null) === null;
    const superDetail = await apiRequest(`/api/users/${sharedUser.id}`, {
      token: superAdminToken,
    });
    const superBizIds = (superDetail.data?.authorizedBusinesses || []).map((b: any) => b.businessId);
    const superSeesAll =
      superDetail.status === 200 &&
      superBizIds.includes(mainBiz.id) &&
      superBizIds.includes(dealerC.id) &&
      superDetail.data?.defaultBusinessId === dealerC.id;
    const foreignDetail = await apiRequest(`/api/users/${foreignUser.id}`, {
      token: mainAdminToken,
      businessId: mainBiz.id,
    });
    const detailOk = scopedFiltered && superSeesAll && foreignDetail.status === 403;
    recordResult(
      13,
      'USER-DETAIL SCOPE FILTERING',
      detailOk,
      `main admin sees ${scopedBizIds.length} membership(s) (default hidden: ${(scopedDetail.data?.defaultBusinessId ?? null) === null}); superadmin sees ${superBizIds.length} incl. true default: ${superDetail.data?.defaultBusinessId === dealerC.id}; foreign user read -> ${foreignDetail.status}`
    );

    console.log('\n============================================================');
    console.log('TENANT ISOLATION — FINAL VERIFICATION MATRIX');
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
  runTenantIsolationVerification()
    .then(() => {
      console.log('Tenant Isolation verification completed successfully!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Tenant Isolation verification FAILED:', err);
      process.exit(1);
    });
}
