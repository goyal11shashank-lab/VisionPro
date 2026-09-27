/**
 * Phase 4C — Dealer Onboarding & First-Login Experience
 * Comprehensive Runtime & Security Verification Test Suite
 */

import { db, pool } from '../db/index.js';
import {
  businesses,
  users,
  userBusinessAccess,
  userRoles,
  roles,
  auditLogs,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { DealerCreationService } from '../services/dealerCreationService.js';
import { DealerUserService } from '../services/dealerUserService.js';
import { generateAuthToken } from '../auth/jwt.js';

const API_BASE = 'http://127.0.0.1:3000';

export interface Phase4CTestResult {
  stepNumber: number;
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

export async function runPhase4CTestSuite(): Promise<{
  passed: number;
  failed: number;
  results: Phase4CTestResult[];
}> {
  const results: Phase4CTestResult[] = [];

  function record(stepNumber: number, name: string, pass: boolean, details: string) {
    results.push({
      stepNumber,
      name,
      status: pass ? 'PASS' : 'FAIL',
      details,
    });
    console.log(`[TEST_STEP_${stepNumber}] [${pass ? 'PASS' : 'FAIL'}] ${name} - ${details}`);
  }

  try {
    // 0. Setup: Ensure Main Warehouse exists
    const [mainBiz] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.businessType, 'MAIN'))
      .limit(1);

    if (!mainBiz) {
      throw new Error('No Main Warehouse business found in database');
    }

    const [superAdminUser] = await db
      .select()
      .from(users)
      .where(eq(users.isSuperAdmin, true))
      .limit(1);

    if (!superAdminUser) {
      throw new Error('No SuperAdmin user found in database');
    }

    // 1. Create a Fresh Dealer Business and a Manager User for testing
    const suffix = Date.now().toString().slice(-4);
    const dealerCreationResult = await DealerCreationService.createDealer(
      mainBiz.id,
      superAdminUser.id,
      {
        name: `Test Dealer Store ${suffix}`,
        tradeName: `Store ${suffix}`,
        gstin: `29AAACP${suffix}A1Z5`,
        city: 'Bangalore',
        state: 'Karnataka',
        stateCode: '29',
        pincode: '560001',
        creditLimit: 250000,
        creditDays: 30,
        phone: '9876543210',
        email: `dealer_${suffix}@example.com`,
      }
    );

    const dealerBizId = dealerCreationResult.dealer.id;
    const dealerCode = dealerCreationResult.dealer.code;

    // Fetch roles
    const [managerRole] = await db.select().from(roles).where(eq(roles.code, 'MANAGER'));
    const [viewerRole] = await db.select().from(roles).where(eq(roles.code, 'VIEWER'));

    if (!managerRole || !viewerRole) {
      throw new Error('MANAGER or VIEWER role not found in roles table');
    }

    // Create Manager User
    const managerCreationResult = await DealerUserService.createDealerUser(
      dealerBizId,
      superAdminUser.id,
      true,
      {
        username: `dlr_mgr_${suffix}`,
        password: 'StrongPassword123!',
        fullName: `Dealer Manager ${suffix}`,
        roleId: managerRole.id,
      }
    );

    const managerToken = generateAuthToken({
      userId: managerCreationResult.user.id,
      username: managerCreationResult.user.username,
      isSuperAdmin: false,
      businessId: dealerBizId,
    });

    // Create Viewer User
    const viewerCreationResult = await DealerUserService.createDealerUser(
      dealerBizId,
      superAdminUser.id,
      true,
      {
        username: `dlr_vwr_${suffix}`,
        password: 'StrongPassword123!',
        fullName: `Dealer Viewer ${suffix}`,
        roleId: viewerRole.id,
      }
    );

    const viewerToken = generateAuthToken({
      userId: viewerCreationResult.user.id,
      username: viewerCreationResult.user.username,
      isSuperAdmin: false,
      businessId: dealerBizId,
    });

    const mainToken = generateAuthToken({
      userId: superAdminUser.id,
      username: superAdminUser.username,
      isSuperAdmin: true,
      businessId: mainBiz.id,
    });

    // =========================================================================
    // STEP 1: NEW DEALER FIRST LOGIN
    // =========================================================================
    {
      const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: `dlr_mgr_${suffix}`,
          password: 'StrongPassword123!',
        }),
      });
      const loginData = await loginRes.json();

      const passLogin =
        loginRes.status === 200 &&
        loginData.currentBusiness?.businessType === 'DEALER' &&
        loginData.currentBusiness?.onboardingCompleted === false;

      // Also verify onboarding status endpoint
      const statusRes = await fetch(`${API_BASE}/api/dealer/onboarding/status`, {
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });
      const statusData = await statusRes.json();

      const passStatus =
        statusRes.status === 200 &&
        statusData.onboardingCompleted === false &&
        statusData.isDealer === true &&
        statusData.dealer.code === dealerCode &&
        statusData.mainWarehouse.name === mainBiz.name &&
        statusData.canConfigure === true;

      record(
        1,
        'NEW DEALER FIRST LOGIN',
        passLogin && passStatus,
        `Login returned businessType: ${loginData.currentBusiness?.businessType}, onboardingCompleted: ${loginData.currentBusiness?.onboardingCompleted}. Status endpoint returned dealer code ${statusData.dealer?.code} linked to ${statusData.mainWarehouse?.name}.`
      );
    }

    // =========================================================================
    // STEP 2: ONBOARDING SAVE (Business Details)
    // =========================================================================
    {
      const updateRes = await fetch(`${API_BASE}/api/dealer/onboarding/business-details`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
        body: JSON.stringify({
          name: `Updated Dealer Store ${suffix}`,
          phone: '9988776655',
          email: `updated_dealer_${suffix}@example.com`,
          addressLine1: 'Suite 404, Tech Park',
          city: 'Bengaluru',
          state: 'Karnataka',
          stateCode: '29',
          pincode: '560002',
        }),
      });
      const updateData = await updateRes.json();

      // Check database directly
      const [updatedBiz] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, dealerBizId));

      const [auditEntry] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.businessId, dealerBizId),
            eq(auditLogs.action, 'DEALER_BUSINESS_UPDATED')
          )
        )
        .limit(1);

      const passUpdate =
        updateRes.status === 200 &&
        updateData.success === true &&
        updatedBiz?.phone === '9988776655' &&
        updatedBiz?.email === `updated_dealer_${suffix}@example.com` &&
        updatedBiz?.addressLine1 === 'Suite 404, Tech Park' &&
        Boolean(auditEntry);

      record(
        2,
        'ONBOARDING SAVE BUSINESS DETAILS',
        passUpdate,
        `Updated phone to ${updatedBiz?.phone}, email to ${updatedBiz?.email}. Audit log action DEALER_BUSINESS_UPDATED verified.`
      );
    }

    // =========================================================================
    // STEP 3: TOGGLE PREFERENCE (Stock Sharing)
    // =========================================================================
    {
      const prefRes = await fetch(`${API_BASE}/api/dealer/onboarding/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
        body: JSON.stringify({
          shareStockWithMain: true,
        }),
      });
      const prefData = await prefRes.json();

      const [prefBiz] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, dealerBizId));

      const isSharing = Boolean((prefBiz?.settingsConfig as any)?.dealer?.shareStockWithMain);

      const passPref = prefRes.status === 200 && prefData.success === true && isSharing === true;

      record(
        3,
        'TOGGLE PREFERENCE',
        passPref,
        `Stock sharing preference saved: ${isSharing} in settings_config.dealer.shareStockWithMain.`
      );
    }

    // =========================================================================
    // STEP 4: COMPLETE ONBOARDING
    // =========================================================================
    {
      const completeRes = await fetch(`${API_BASE}/api/dealer/onboarding/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });
      const completeData = await completeRes.json();

      const [completedBiz] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, dealerBizId));

      const isCompleted = Boolean((completedBiz?.settingsConfig as any)?.dealer?.onboardingCompleted);

      const [completeAudit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.businessId, dealerBizId),
            eq(auditLogs.action, 'DEALER_ONBOARDING_COMPLETED')
          )
        )
        .limit(1);

      const passComplete =
        completeRes.status === 200 &&
        completeData.success === true &&
        isCompleted === true &&
        Boolean(completeAudit);

      record(
        4,
        'COMPLETE ONBOARDING',
        passComplete,
        `Finish Setup marked onboardingCompleted: ${isCompleted} in database. Audit log DEALER_ONBOARDING_COMPLETED recorded.`
      );
    }

    // =========================================================================
    // STEP 5: SUBSEQUENT LOGIN
    // =========================================================================
    {
      const reloginRes = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: `dlr_mgr_${suffix}`,
          password: 'StrongPassword123!',
        }),
      });
      const reloginData = await reloginRes.json();

      const statusRes = await fetch(`${API_BASE}/api/dealer/onboarding/status`, {
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });
      const statusData = await statusRes.json();

      const passSubsequent =
        reloginRes.status === 200 &&
        reloginData.currentBusiness?.onboardingCompleted === true &&
        statusData.onboardingCompleted === true;

      record(
        5,
        'SUBSEQUENT LOGIN',
        passSubsequent,
        `Subsequent login returned onboardingCompleted: ${reloginData.currentBusiness?.onboardingCompleted}. User will land directly on dealer dashboard.`
      );
    }

    // =========================================================================
    // STEP 6: DEALER DASHBOARD EMPTY STATES
    // =========================================================================
    {
      const dashRes = await fetch(`${API_BASE}/api/dealer/dashboard/summary`, {
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });
      const dashData = await dashRes.json();

      const passDash =
        dashRes.status === 200 &&
        dashData.success === true &&
        dashData.kpis?.myAvailableStock === 0 &&
        dashData.kpis?.myPhysicalStock === 0 &&
        Array.isArray(dashData.recentOrders) &&
        dashData.recentOrders.length === 0;

      record(
        6,
        'DEALER DASHBOARD EMPTY STATES',
        passDash,
        `Dealer dashboard summary returned 200 OK with 0 available stock and 0 orders. Ready for empty state handling.`
      );
    }

    // =========================================================================
    // STEP 7: DEALER VIEWER BEHAVIOR
    // =========================================================================
    {
      // Viewer can read status
      const viewerStatusRes = await fetch(`${API_BASE}/api/dealer/onboarding/status`, {
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });
      const viewerStatusData = await viewerStatusRes.json();

      // Viewer cannot edit details
      const viewerEditRes = await fetch(`${API_BASE}/api/dealer/onboarding/business-details`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerToken}`,
          'X-Business-Id': dealerBizId,
        },
        body: JSON.stringify({ name: 'Hacked Store Name' }),
      });

      // Viewer cannot complete
      const viewerCompleteRes = await fetch(`${API_BASE}/api/dealer/onboarding/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });

      const passViewer =
        viewerStatusRes.status === 200 &&
        viewerStatusData.canConfigure === false &&
        viewerEditRes.status === 403 &&
        viewerCompleteRes.status === 403;

      record(
        7,
        'DEALER VIEWER BEHAVIOR',
        passViewer,
        `Viewer has canConfigure: false. Edit returned status ${viewerEditRes.status} (403), Complete returned status ${viewerCompleteRes.status} (403). Non-manager cannot modify setup.`
      );
    }

    // =========================================================================
    // STEP 8: MAIN BUSINESS UNAFFECTED
    // =========================================================================
    {
      const mainStatusRes = await fetch(`${API_BASE}/api/dealer/onboarding/status`, {
        headers: {
          Authorization: `Bearer ${mainToken}`,
          'X-Business-Id': mainBiz.id,
        },
      });

      const passMain = mainStatusRes.status === 403;

      record(
        8,
        'MAIN BUSINESS UNAFFECTED',
        passMain,
        `Main warehouse business rejected from dealer onboarding status with status ${mainStatusRes.status} (403). Main users never see dealer onboarding.`
      );
    }

    // =========================================================================
    // STEP 9: IDEMPOTENT COMPLETION
    // =========================================================================
    {
      const secondCompleteRes = await fetch(`${API_BASE}/api/dealer/onboarding/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': dealerBizId,
        },
      });
      const secondCompleteData = await secondCompleteRes.json();

      const [completedBiz2] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, dealerBizId));

      const isStillCompleted = Boolean((completedBiz2?.settingsConfig as any)?.dealer?.onboardingCompleted);

      const passIdempotent =
        secondCompleteRes.status === 200 &&
        secondCompleteData.success === true &&
        isStillCompleted === true;

      record(
        9,
        'IDEMPOTENT COMPLETION',
        passIdempotent,
        `Calling complete a second time succeeded (200 OK) without errors. Settings and flags remain intact.`
      );
    }

  } catch (err: any) {
    console.error('[TEST_RUN_ERROR]', err);
    record(0, 'TEST RUNNER ENCOUNTERED ERROR', false, err.message || String(err));
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n======================================================`);
  console.log(`PHASE 4C DEALER ONBOARDING TEST SUITE SUMMARY:`);
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`======================================================\n`);

  return { passed, failed, results };
}

// Self-executing if run directly via tsx
if (process.argv[1]?.includes('phase4cDealerOnboarding.test.ts')) {
  runPhase4CTestSuite()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
