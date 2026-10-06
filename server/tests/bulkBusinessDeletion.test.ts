import { pool, db } from '../db/index.js';
import { businesses, users, userBusinessAccess } from '../db/schema.js';

async function runTest() {
  console.log('--- STARTING BULK BUSINESS DELETION VERIFICATION ---');

  // 1. Get or create a super admin user for testing
  const adminRes = await pool.query(`SELECT id, username FROM users WHERE is_super_admin = true LIMIT 1`);
  if (adminRes.rows.length === 0) {
    throw new Error('No super admin found in database');
  }
  const superAdmin = adminRes.rows[0];
  console.log(`Using Super Admin: ${superAdmin.username} (${superAdmin.id})`);

  // 2. Get an existing business to act as currentBusinessId
  const defaultBizRes = await pool.query(`SELECT id, name FROM businesses LIMIT 1`);
  if (defaultBizRes.rows.length === 0) {
    throw new Error('No businesses found in database');
  }
  const currentBusiness = defaultBizRes.rows[0];
  const currentBusinessId = currentBusiness.id;
  console.log(`Current Business for session: ${currentBusiness.name} (${currentBusinessId})`);

  // 3. Create 3 test businesses:
  // Biz A: Clean dummy business 1
  // Biz B: Clean dummy business 2
  // Biz C: Dummy business with an operational record (a party)
  const bizARes = await pool.query(`
    INSERT INTO businesses (name, trade_name, status, business_type, created_by, created_at, updated_at)
    VALUES ('Test Clean Warehouse A', 'Clean A', 'ACTIVE', 'MAIN', $1, NOW(), NOW())
    RETURNING id, name
  `, [superAdmin.id]);
  const bizA = bizARes.rows[0];

  const bizBRes = await pool.query(`
    INSERT INTO businesses (name, trade_name, status, business_type, created_by, created_at, updated_at)
    VALUES ('Test Clean Warehouse B', 'Clean B', 'ACTIVE', 'MAIN', $1, NOW(), NOW())
    RETURNING id, name
  `, [superAdmin.id]);
  const bizB = bizBRes.rows[0];

  const bizCRes = await pool.query(`
    INSERT INTO businesses (name, trade_name, status, business_type, created_by, created_at, updated_at)
    VALUES ('Test Blocked Warehouse C', 'Blocked C', 'ACTIVE', 'MAIN', $1, NOW(), NOW())
    RETURNING id, name
  `, [superAdmin.id]);
  const bizC = bizCRes.rows[0];

  // Insert business_settings and user_business_access for test businesses
  for (const b of [bizA, bizB, bizC]) {
    await pool.query(`
      INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
      VALUES ($1, $2, false, NOW())
      ON CONFLICT DO NOTHING
    `, [superAdmin.id, b.id]);
    await pool.query(`
      INSERT INTO business_settings (business_id, low_stock_threshold, created_at, updated_at)
      VALUES ($1, 5, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `, [b.id]);
  }

  // Create an operational party in Biz C to simulate dependencies
  await pool.query(`
    INSERT INTO parties (business_id, party_type, name, party_code, mobile, created_by, created_at, updated_at)
    VALUES ($1, 'CUSTOMER', 'Test Dependency Customer', 'CUST-TEST-001', '9876543210', $2, NOW(), NOW())
  `, [bizC.id, superAdmin.id]);

  console.log(`Created test businesses:
  - Biz A (Clean): ${bizA.id}
  - Biz B (Clean): ${bizB.id}
  - Biz C (With Party): ${bizC.id}`);

  // 4. Test API call to bulk-delete with current business, clean business, and blocked business
  const { default: express } = await import('express');
  const { default: businessesRouter } = await import('../routes/businesses.js');
  const { generateAuthToken } = await import('../auth/jwt.js');

  const authToken = generateAuthToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    isSuperAdmin: true,
    businessId: currentBusinessId,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/businesses', businessesRouter);

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8999;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log('\n--- TEST CASE 1: BULK DELETE INCLUDING CURRENT, CLEAN, AND BLOCKED ---');
  const testIds = [currentBusinessId, bizA.id, bizB.id, bizC.id];
  const resp1 = await fetch(`${baseUrl}/api/businesses/bulk-delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ ids: testIds }),
  });
  const res1Body = await resp1.json();

  console.log('Status:', resp1.status);
  console.log('Result body:', JSON.stringify(res1Body, null, 2));

  // Assertions:
  // - Biz A and Biz B should be deleted (deletedCount >= 2)
  // - currentBusinessId should be blocked (cannot delete active session)
  // - Biz C should be blocked (has party dependency)
  if (res1Body.deletedCount !== 2) {
    server.close();
    throw new Error(`Expected deletedCount to be 2, got ${res1Body.deletedCount}`);
  }
  if (!res1Body.deletedIds.includes(bizA.id) || !res1Body.deletedIds.includes(bizB.id)) {
    server.close();
    throw new Error('Biz A and Biz B were not deleted');
  }
  const blockedIds = res1Body.blockedBusinesses.map((b: any) => b.id);
  if (!blockedIds.includes(currentBusinessId)) {
    server.close();
    throw new Error('Active currentBusinessId was not blocked');
  }
  if (!blockedIds.includes(bizC.id)) {
    server.close();
    throw new Error('Biz C with operational records was not blocked');
  }
  console.log('✓ TEST CASE 1 PASSED: Clean businesses deleted, active & dependent businesses protected!');

  // Verify DB state for Biz A and Biz B
  const checkA = await pool.query(`SELECT id FROM businesses WHERE id = $1`, [bizA.id]);
  const checkB = await pool.query(`SELECT id FROM businesses WHERE id = $1`, [bizB.id]);
  if (checkA.rows.length !== 0 || checkB.rows.length !== 0) {
    server.close();
    throw new Error('Biz A or Biz B still exists in database!');
  }
  console.log('✓ DB Verified: Biz A and Biz B records removed completely.');

  console.log('\n--- TEST CASE 2: BULK STATUS UPDATE (DEACTIVATE) ---');
  const resp2 = await fetch(`${baseUrl}/api/businesses/bulk-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ ids: [bizC.id], status: 'INACTIVE' }),
  });
  const res2Body = await resp2.json();
  server.close();

  console.log('Bulk Status Result:', JSON.stringify(res2Body, null, 2));
  if (res2Body.updatedCount !== 1) {
    throw new Error(`Expected updatedCount 1, got ${res2Body.updatedCount}`);
  }

  const checkC = await pool.query(`SELECT status FROM businesses WHERE id = $1`, [bizC.id]);
  if (checkC.rows[0]?.status !== 'INACTIVE') {
    throw new Error(`Expected Biz C status INACTIVE, got ${checkC.rows[0]?.status}`);
  }
  console.log('✓ TEST CASE 2 PASSED: Bulk status update works as expected!');

  // Clean up Biz C test records
  await pool.query(`DELETE FROM parties WHERE business_id = $1`, [bizC.id]);
  await pool.query(`DELETE FROM user_business_access WHERE business_id = $1`, [bizC.id]);
  await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [bizC.id]);
  await pool.query(`DELETE FROM businesses WHERE id = $1`, [bizC.id]);
  console.log('✓ Cleaned up test party and Biz C');

  console.log('\n--- ALL BULK BUSINESS DELETION VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
