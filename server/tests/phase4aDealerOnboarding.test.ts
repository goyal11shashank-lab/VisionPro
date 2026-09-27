import { pool } from '../db/index.js';
import { seedInitialDatabase } from '../db/seed.js';
import { DealerCreationService } from '../services/dealerCreationService.js';
import { DealerControlService } from '../services/dealerControlService.js';

interface TestResult {
  step: number;
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function assert(step: number, name: string, condition: boolean, message: string) {
  results.push({ step, name, passed: condition, message });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`[Step ${step}] ${status}: ${name} -> ${message}`);
  if (!condition) {
    throw new Error(`Test failed at Step ${step} [${name}]: ${message}`);
  }
}

export async function runPhase4aTests() {
  console.log('\n============================================================');
  console.log('PHASE 4A — DEALER ONBOARDING & COMMERCIAL LINKING TEST SUITE');
  console.log('============================================================\n');

  await seedInitialDatabase();
  const runId = Date.now().toString(36).toUpperCase();
  const client = await pool.connect();

  try {
    // 1. Create Isolated Test Main Warehouse & A Dealer Context
    console.log('Setting up isolated test businesses for Phase 4A...');
    const mainBizRes = await client.query(
      `INSERT INTO businesses (
        name, trade_name, gstin, pan, phone, email,
        address_line1, city, state, state_code, pincode,
        business_type, status, currency
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        'MAIN', 'ACTIVE', 'INR'
      ) RETURNING id, name, gstin, state`,
      [
        `PHASE4A_MAIN_${runId}`,
        `Care Optics Main Hub ${runId}`,
        `27AABCC${runId.slice(0, 4)}1Z1`,
        `AABCC${runId.slice(0, 4)}A`,
        '9876543210',
        `main_${runId}@example.com`,
        '100 Industrial Estate',
        'Mumbai',
        'Maharashtra',
        '27',
        '400001',
      ]
    );
    const mainBiz = mainBizRes.rows[0];

    const testAdminUserRes = await client.query(
      `INSERT INTO users (
        username, email, mobile, full_name, password_hash, is_super_admin, status
      ) VALUES (
        $1, $2, $3, $4, 'hash_placeholder', false, 'ACTIVE'
      ) RETURNING id, username`,
      [`admin_${runId}`, `admin_${runId}@example.com`, `999${runId.slice(0, 7)}`, `Admin ${runId}`]
    );
    const testAdminUser = testAdminUserRes.rows[0];

    // Link user to Main business
    await client.query(
      `INSERT INTO user_business_access (user_id, business_id, is_default) VALUES ($1, $2, true)`,
      [testAdminUser.id, mainBiz.id]
    );

    // 2. Test Negative Security Boundary: A DEALER business cannot create another Dealer
    const isolatedDealerRes = await client.query(
      `INSERT INTO businesses (
        name, business_type, parent_business_id, status
      ) VALUES ($1, 'DEALER', $2, 'ACTIVE') RETURNING id`,
      [`DEALER_SUB_${runId}`, mainBiz.id]
    );
    const isolatedDealer = isolatedDealerRes.rows[0];

    let dealerCallingCreateFailed = false;
    try {
      await DealerCreationService.createDealer(isolatedDealer.id, testAdminUser.id, {
        name: `Illegal Child Dealer ${runId}`,
      });
    } catch (err: any) {
      dealerCallingCreateFailed = true;
      assert(1, 'Dealer Cannot Create Dealer', err.message.includes('Only a MAIN Warehouse'), 'Blocked dealer-creating-dealer');
    }
    assert(2, 'Dealer Security Boundary Enforced', dealerCallingCreateFailed, 'DEALER caller threw security error');

    // 3. Test Human-Friendly Dealer Code Generation (DLR-0001, DLR-0002)
    const code1 = await DealerCreationService.generateDealerCode(mainBiz.id);
    assert(3, 'Dealer Code Format', /^DLR-\d{4}$/.test(code1), `Generated code: ${code1}`);

    // 4. Test Atomic Creation with Automatic Customer Provisioning
    const createRes = await DealerCreationService.createDealer(mainBiz.id, testAdminUser.id, {
      name: `Vision World Dealer ${runId}`,
      tradeName: `Vision World ${runId}`,
      gstin: `27AABCD${runId.slice(0, 4)}1Z2`,
      pan: `AABCD${runId.slice(0, 4)}A`,
      phone: '9820123456',
      email: `dealer_${runId}@vision.com`,
      addressLine1: '45 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      stateCode: '27',
      pincode: '411001',
      creditLimit: 250000,
      creditDays: 30,
      customerLinkMode: 'CREATE_NEW',
    });

    assert(4, 'Dealer Creation Successful', createRes.success === true, 'Returned success = true');
    assert(5, 'Dealer Code Assigned', createRes.dealer.code === code1, `Dealer assigned code ${createRes.dealer.code}`);
    assert(6, 'Business Type Enforced', createRes.dealer.business_type === 'DEALER', 'business_type is DEALER');
    assert(7, 'Parent Business Enforced', createRes.dealer.parent_business_id === mainBiz.id, 'parent is mainBiz.id');

    const createdDealerId = createRes.dealer.id;

    // 5. Verify Dealer Settings default: shareStockWithMain = false
    const dSettingsRes = await client.query(
      `SELECT config FROM business_settings WHERE business_id = $1`,
      [createdDealerId]
    );
    assert(8, 'Dealer Settings Configured', dSettingsRes.rows.length > 0, 'business_settings created');
    assert(
      9,
      'Stock Sharing Default OFF',
      dSettingsRes.rows[0].config?.dealer?.shareStockWithMain === false,
      'shareStockWithMain is false by default'
    );

    // 6. Verify Main Customer Party created inside Main Warehouse
    assert(10, 'Main Customer Party Provisioned', Boolean(createRes.customerParty?.id), 'Customer party ID returned');
    const custRes = await client.query(
      `SELECT id, business_id, party_type, credit_limit, credit_days, notes, gstin 
       FROM parties WHERE id = $1`,
      [createRes.customerParty.id]
    );
    assert(11, 'Customer in Main Tenant', custRes.rows[0]?.business_id === mainBiz.id, 'Customer belongs to mainBiz.id');
    assert(12, 'Customer Party Type', custRes.rows[0]?.party_type === 'CUSTOMER', 'Party type is CUSTOMER');
    assert(13, 'Customer Credit Terms', parseFloat(custRes.rows[0]?.credit_limit) === 250000, 'Credit limit 250,000');
    assert(14, 'Customer Notes Tagged', custRes.rows[0]?.notes.includes(`[DEALER_BIZ:${createdDealerId}]`), 'Notes contain [DEALER_BIZ:id]');

    // 7. Verify Dealer-side Main Supplier Party created inside Dealer Business
    assert(15, 'Dealer Main Supplier Provisioned', Boolean(createRes.supplierParty?.id), 'Supplier party ID returned');
    const supRes = await client.query(
      `SELECT id, business_id, party_type, notes, name 
       FROM parties WHERE id = $1`,
      [createRes.supplierParty.id]
    );
    assert(16, 'Supplier in Dealer Tenant', supRes.rows[0]?.business_id === createdDealerId, 'Supplier belongs to dealer business');
    assert(17, 'Supplier Party Type', supRes.rows[0]?.party_type === 'SUPPLIER', 'Party type is SUPPLIER');
    assert(18, 'Supplier Notes Tagged', supRes.rows[0]?.notes.includes(`[MAIN_BIZ:${mainBiz.id}]`), 'Notes contain [MAIN_BIZ:id]');
    assert(19, 'Supplier Name Matches Main', supRes.rows[0]?.name === mainBiz.name, 'Supplier name matches Main Warehouse name');

    // 8. Test Resolution via Existing DealerControlService
    const resolvedPartyId = await DealerControlService.resolveDealerPartyId(client, mainBiz.id, createdDealerId);
    assert(20, 'Existing Party Resolver Works', resolvedPartyId === createRes.customerParty.id, 'DealerControlService resolves the party correctly');

    // 9. Test Rapid Duplicate Submission Prevention (Idempotency)
    let duplicateRejected = false;
    try {
      await DealerCreationService.createDealer(mainBiz.id, testAdminUser.id, {
        name: `Vision World Dealer ${runId}`, // identical name in same Main
      });
    } catch (dupErr: any) {
      duplicateRejected = true;
      assert(21, 'Duplicate Submission Prevented', dupErr.message.includes('just created'), 'Rapid duplicate detected');
    }
    assert(22, 'Idempotency Active', duplicateRejected, 'Duplicate creation threw error');

    // 10. Test Duplicate Customer Detection (GSTIN & Name)
    const dupCheck = await DealerCreationService.checkCustomerDuplicate(
      mainBiz.id,
      `27AABCD${runId.slice(0, 4)}1Z2`,
      `Vision World Dealer ${runId}`
    );
    assert(23, 'Duplicate Customer Check', dupCheck.hasProbableDuplicate === true, 'Detected duplicate customer');
    assert(24, 'Probable Matches Found', dupCheck.probableMatches.length > 0, `Matches: ${dupCheck.probableMatches.length}`);

    // 11. Test Linking Existing Customer
    // First, create a standalone customer in Main Warehouse
    const standaloneCustRes = await client.query(
      `INSERT INTO parties (
        business_id, party_code, name, display_name, party_type, status, gstin, city, state
      ) VALUES (
        $1, $2, $3, $4, 'CUSTOMER', 'ACTIVE', $5, 'Nashik', 'Maharashtra'
      ) RETURNING id, party_code`,
      [
        mainBiz.id,
        `CUST-STANDALONE-${runId}`,
        `Existing Optical Store ${runId}`,
        `Existing Optical ${runId}`,
        `27AABCE${runId.slice(0, 4)}1Z3`,
      ]
    );
    const standaloneCust = standaloneCustRes.rows[0];

    // Create a new dealer linking this existing customer
    const linkDealerRes = await DealerCreationService.createDealer(mainBiz.id, testAdminUser.id, {
      name: `Existing Optical Store Dealer ${runId}`,
      customerLinkMode: 'LINK_EXISTING',
      existingCustomerPartyId: standaloneCust.id,
      creditLimit: 500000,
      creditDays: 45,
    });

    assert(25, 'Dealer Linked To Existing Customer', linkDealerRes.success === true, 'Created dealer with linked customer');
    assert(26, 'Customer Party Reused', linkDealerRes.customerParty?.id === standaloneCust.id, 'Reused existing party ID');

    const updatedLinkedCust = await client.query(
      `SELECT notes, credit_limit, credit_days FROM parties WHERE id = $1`,
      [standaloneCust.id]
    );
    assert(
      27,
      'Linked Customer Notes Updated',
      updatedLinkedCust.rows[0].notes.includes(`[DEALER_BIZ:${linkDealerRes.dealer.id}]`),
      'Existing customer notes received [DEALER_BIZ:id] tag'
    );
    assert(
      28,
      'Linked Customer Credit Updated',
      parseFloat(updatedLinkedCust.rows[0].credit_limit) === 500000,
      'Credit limit set to 500,000'
    );

    // 12. Test Administration Tab Details API
    const adminInfo = await DealerCreationService.getDealerAdministrationInfo(mainBiz.id, createdDealerId);
    assert(29, 'Admin Tab Info Fetched', Boolean(adminInfo.dealer), 'Dealer details returned');
    assert(30, 'Admin Tab Code', adminInfo.dealer.code === code1, 'Dealer code present');
    assert(31, 'Admin Tab Linked Customer', adminInfo.customerParty?.id === createRes.customerParty.id, 'Linked customer in admin tab');
    assert(32, 'Admin Tab Linked Supplier', adminInfo.supplierParty?.id === createRes.supplierParty.id, 'Linked supplier in admin tab');
    assert(33, 'Admin Tab Stock Sharing Off', adminInfo.shareStockWithMain === false, 'Stock sharing reported as false');
    assert(34, 'Admin Tab Users Count', adminInfo.userCount === 0, 'User count is 0');

    // 13. Test Update Dealer Details with Controlled Synchronization
    const updateRes = await DealerCreationService.updateDealer(
      mainBiz.id,
      createdDealerId,
      testAdminUser.id,
      {
        tradeName: `Vision World Prime ${runId}`,
        phone: '9988776655',
        creditLimit: 300000,
        syncToCustomerParty: true,
      }
    );
    assert(35, 'Dealer Updated', updateRes.success === true, 'Dealer updated successfully');
    assert(36, 'Trade Name Updated', updateRes.dealer.trade_name === `Vision World Prime ${runId}`, 'Trade name saved');

    const syncedCust = await client.query(
      `SELECT display_name, mobile, credit_limit FROM parties WHERE id = $1`,
      [createRes.customerParty.id]
    );
    assert(
      37,
      'Customer Master Synced',
      syncedCust.rows[0].display_name === `Vision World Prime ${runId}`,
      'Customer display_name synced'
    );
    assert(
      38,
      'Customer Credit Synced',
      parseFloat(syncedCust.rows[0].credit_limit) === 300000,
      'Customer credit limit synced to 300,000'
    );

    // 14. Test Deactivation Warnings and Status Change
    const deactWarnings = await DealerCreationService.getDeactivationWarnings(mainBiz.id, createdDealerId);
    assert(39, 'Deactivation Warnings Checked', deactWarnings.hasOperationalDependencies === false, 'Zero operational warnings for new dealer');

    const deactRes = await DealerCreationService.deactivateDealer(mainBiz.id, createdDealerId, testAdminUser.id);
    assert(40, 'Dealer Deactivated', deactRes.dealer.status === 'INACTIVE', 'Dealer status set to INACTIVE');

    const actRes = await DealerCreationService.activateDealer(mainBiz.id, createdDealerId, testAdminUser.id);
    assert(41, 'Dealer Activated', actRes.dealer.status === 'ACTIVE', 'Dealer status restored to ACTIVE');

    // 15. Test Delete Empty Dealer
    const deleteRes = await DealerCreationService.deleteEmptyDealer(mainBiz.id, linkDealerRes.dealer.id, testAdminUser.id);
    assert(42, 'Empty Dealer Deleted', deleteRes.success === true, 'Deleted empty dealer successfully');

    const checkDeleted = await client.query(`SELECT id FROM businesses WHERE id = $1`, [linkDealerRes.dealer.id]);
    assert(43, 'Dealer Removed from DB', checkDeleted.rows.length === 0, 'Dealer row deleted');

    // 16. Test Non-Empty Dealer Delete Rejection
    // Add an assigned user to createdDealerId to make it non-empty
    await client.query(
      `INSERT INTO user_business_access (user_id, business_id, is_default) VALUES ($1, $2, false)`,
      [testAdminUser.id, createdDealerId]
    );

    let deleteBlocked = false;
    try {
      await DealerCreationService.deleteEmptyDealer(mainBiz.id, createdDealerId, testAdminUser.id);
    } catch (delErr: any) {
      deleteBlocked = true;
      assert(44, 'Non-Empty Dealer Delete Blocked', delErr.message.includes('active records') || delErr.message.includes('Cannot delete'), 'Blocked deletion with orders');
    }
    assert(45, 'Delete Dependency Protection Verified', deleteBlocked, 'Delete was safely blocked');

    console.log('\n============================================================');
    console.log(`ALL 45/45 PHASE 4A TESTS PASSED SUCCESSFULLY!`);
    console.log('============================================================\n');
  } finally {
    client.release();
  }
}

// Auto-run if executed directly
if (process.argv[1]?.includes('phase4aDealerOnboarding')) {
  runPhase4aTests()
    .then(() => {
      console.log('Phase 4A Tests execution finished with 0 errors.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Phase 4A Tests execution aborted:', err);
      process.exit(1);
    });
}
