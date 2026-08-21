import { db, pool } from './index.js';
import {
  businesses, users, roles, permissions, rolePermissions, userBusinessAccess, userRoles, auditLogs,
  categories, coatings, bases, baseCategories, primaryItems, uniqueItems
} from './schema.js';
import { hashPassword } from '../auth/password.js';
import { eq, and } from 'drizzle-orm';
import { runMigrations } from './migrate.js';

export const SYSTEM_PERMISSIONS = [
  // Master Data Module
  { module: 'master', action: 'view', code: 'master:view', description: 'View optical categories, bases, coatings, items, and batches' },
  { module: 'master', action: 'create', code: 'master:create', description: 'Create optical categories, bases, coatings, items, and batches' },
  { module: 'master', action: 'edit', code: 'master:edit', description: 'Edit optical master data properties' },
  { module: 'master', action: 'delete', code: 'master:delete', description: 'Archive or remove unreferenced master entities' },

  // Sales Module
  { module: 'sales', action: 'view', code: 'sales:view', description: 'View sales orders, invoices, and returns' },
  { module: 'sales', action: 'create', code: 'sales:create', description: 'Create new sales orders and invoices' },
  { module: 'sales', action: 'edit', code: 'sales:edit', description: 'Edit pending sales documents' },
  { module: 'sales', action: 'delete', code: 'sales:delete', description: 'Delete draft sales orders' },
  { module: 'sales', action: 'cancel', code: 'sales:cancel', description: 'Cancel finalized sales invoices' },
  { module: 'sales', action: 'approve', code: 'sales:approve', description: 'Approve special discounts or credit limits' },
  { module: 'sales', action: 'export', code: 'sales:export', description: 'Export sales registers and reports' },
  { module: 'sales', action: 'edit_sale_price', code: 'sales:edit_sale_price', description: 'Override default sales price on items' },
  { module: 'sales', action: 'return_view', code: 'sales:return:view', description: 'View sales return credit notes' },
  { module: 'sales', action: 'return_create', code: 'sales:return:create', description: 'Create sales return credit notes' },
  { module: 'sales', action: 'return_post', code: 'sales:return:post', description: 'Post sales return and restore original batch stock' },
  { module: 'sales', action: 'return_cancel', code: 'sales:return:cancel', description: 'Cancel sales return document' },

  // Purchase Module
  { module: 'purchase', action: 'view', code: 'purchase:view', description: 'View purchase orders, inward bills and returns' },
  { module: 'purchase', action: 'create', code: 'purchase:create', description: 'Record supplier purchase invoices' },
  { module: 'purchase', action: 'edit', code: 'purchase:edit', description: 'Edit purchase records before posting' },
  { module: 'purchase', action: 'delete', code: 'purchase:delete', description: 'Delete draft purchase entries' },
  { module: 'purchase', action: 'cancel', code: 'purchase:cancel', description: 'Cancel approved purchase documents' },
  { module: 'purchase', action: 'return_view', code: 'purchase:return:view', description: 'View purchase return debit notes' },
  { module: 'purchase', action: 'return_create', code: 'purchase:return:create', description: 'Create purchase return debit notes' },
  { module: 'purchase', action: 'return_post', code: 'purchase:return:post', description: 'Post purchase return and reduce stock & lot' },
  { module: 'purchase', action: 'return_cancel', code: 'purchase:return:cancel', description: 'Cancel purchase return document' },
  { module: 'purchase', action: 'approve', code: 'purchase:approve', description: 'Approve vendor inward stock' },
  { module: 'purchase', action: 'view_purchase_price', code: 'purchase:view_purchase_price', description: 'View supplier landed cost and purchase rates' },
  { module: 'purchase', action: 'export', code: 'purchase:export', description: 'Export purchase registers' },

  // Inventory Module
  { module: 'inventory', action: 'view', code: 'inventory:view', description: 'View frame, lens, contact lens stock' },
  { module: 'inventory', action: 'create', code: 'inventory:create', description: 'Add new optical SKU or batch records' },
  { module: 'inventory', action: 'edit', code: 'inventory:edit', description: 'Update item specifications, brand, model' },
  { module: 'inventory', action: 'delete', code: 'inventory:delete', description: 'Remove obsolete unlinked item masters' },
  { module: 'inventory', action: 'adjust_stock', code: 'inventory:adjust_stock', description: 'Perform physical stock count reconciliation and adjustments' },
  { module: 'inventory', action: 'import', code: 'inventory:import', description: 'Bulk import optical item lists via CSV/Excel' },
  { module: 'inventory', action: 'export', code: 'inventory:export', description: 'Export current stock valuation and barcode lists' },

  // Parties Module
  { module: 'parties', action: 'view', code: 'parties:view', description: 'View customer optical prescriptions and supplier records' },
  { module: 'parties', action: 'create', code: 'parties:create', description: 'Create new customer or supplier profiles' },
  { module: 'parties', action: 'edit', code: 'parties:edit', description: 'Update party details, prescription history, GSTIN' },
  { module: 'parties', action: 'delete', code: 'parties:delete', description: 'Delete unused party profiles' },
  { module: 'parties', action: 'export', code: 'parties:export', description: 'Export party directories and ledgers' },

  // Accounts Module
  { module: 'accounts', action: 'view', code: 'accounts:view', description: 'View customer receipts, supplier payments, outstandings' },
  { module: 'accounts', action: 'create', code: 'accounts:create', description: 'Record payment vouchers and receipts' },
  { module: 'accounts', action: 'edit', code: 'accounts:edit', description: 'Modify accounting voucher entries' },
  { module: 'accounts', action: 'delete', code: 'accounts:delete', description: 'Remove un-reconciled voucher drafts' },
  { module: 'accounts', action: 'approve', code: 'accounts:approve', description: 'Approve bank reconciliations and settlement' },
  { module: 'accounts', action: 'export', code: 'accounts:export', description: 'Export financial ledgers and trial balance' },

  // Reports Module
  { module: 'reports', action: 'view', code: 'reports:view', description: 'Access optical business intelligence and analytical reports' },
  { module: 'reports', action: 'export', code: 'reports:export', description: 'Download GST GSTR-1 / GSTR-3B audit summaries' },
  { module: 'reports', action: 'dashboard_view', code: 'report.dashboard.view', description: 'View executive operational KPI dashboard' },
  { module: 'reports', action: 'dashboard_view', code: 'reports:dashboard:view', description: 'View executive operational KPI dashboard (colon notation)' },
  { module: 'reports', action: 'inventory_view', code: 'report.inventory.view', description: 'View comprehensive inventory & optical stock reports' },
  { module: 'reports', action: 'inventory_view', code: 'reports:inventory', description: 'View comprehensive inventory & optical stock reports (colon notation)' },
  { module: 'reports', action: 'stock_ledger_view', code: 'report.stock_ledger.view', description: 'View chronological batch stock ledger journal reports' },
  { module: 'reports', action: 'stock_ledger_view', code: 'reports:stock_ledger', description: 'View chronological batch stock ledger journal reports (colon notation)' },
  { module: 'reports', action: 'purchase_view', code: 'report.purchase.view', description: 'View supplier purchase register and detailed lot reports' },
  { module: 'reports', action: 'purchase_view', code: 'reports:purchase', description: 'View supplier purchase register and detailed lot reports (colon notation)' },
  { module: 'reports', action: 'sales_view', code: 'report.sales.view', description: 'View customer sales register and item/power reports' },
  { module: 'reports', action: 'sales_view', code: 'reports:sales', description: 'View customer sales register and item/power reports (colon notation)' },
  { module: 'reports', action: 'outstanding_view', code: 'report.outstanding.view', description: 'View customer and supplier outstanding aging reports' },
  { module: 'reports', action: 'outstanding_view', code: 'reports:outstanding', description: 'View customer and supplier outstanding aging reports (colon notation)' },
  { module: 'reports', action: 'payment_view', code: 'report.payment.view', description: 'View payment register and mode summary reports' },
  { module: 'reports', action: 'payment_view', code: 'reports:payment', description: 'View payment register and mode summary reports (colon notation)' },
  { module: 'reports', action: 'party_statement_view', code: 'report.party_statement.view', description: 'View individual party running balance statements' },
  { module: 'reports', action: 'party_statement_view', code: 'reports:party_statement', description: 'View individual party running balance statements (colon notation)' },

  // Administration Module
  { module: 'admin', action: 'manage_users', code: 'admin:manage_users', description: 'Create, update, lock, and assign roles to users' },
  { module: 'admin', action: 'manage_roles', code: 'admin:manage_roles', description: 'Configure custom roles and permission assignments' },
  { module: 'admin', action: 'manage_settings', code: 'admin:manage_settings', description: 'Configure business GST, invoice prefixes, and barcode settings' },
  { module: 'admin', action: 'view_audit_logs', code: 'admin:view_audit_logs', description: 'Inspect audit trails of all system modifications' },

  // Phase 7: Bulk Data & Import Permissions
  { module: 'import', action: 'view', code: 'import:view', description: 'View bulk import history and templates' },
  { module: 'import', action: 'view', code: 'import.view', description: 'View bulk import history and templates (dot notation)' },
  { module: 'import', action: 'party', code: 'import:party', description: 'Bulk import customer and supplier directories' },
  { module: 'import', action: 'party', code: 'import.party', description: 'Bulk import customer and supplier directories (dot notation)' },
  { module: 'import', action: 'purchase', code: 'import:purchase', description: 'Bulk import supplier purchase invoices' },
  { module: 'import', action: 'purchase', code: 'import.purchase', description: 'Bulk import supplier purchase invoices (dot notation)' },
  { module: 'import', action: 'sales_order', code: 'import:sales_order', description: 'Bulk import customer sales orders' },
  { module: 'import', action: 'sales_order', code: 'import.sales_order', description: 'Bulk import customer sales orders (dot notation)' },
  { module: 'import', action: 'sales_invoice', code: 'import:sales_invoice', description: 'Bulk import customer sales invoices' },
  { module: 'import', action: 'sales_invoice', code: 'import.sales_invoice', description: 'Bulk import customer sales invoices (dot notation)' },
  { module: 'import', action: 'opening_stock', code: 'import:opening_stock', description: 'Bulk import initial optical batch opening stock balances' },
  { module: 'import', action: 'opening_stock', code: 'import.opening_stock', description: 'Bulk import initial optical batch opening stock balances (dot notation)' },
];

export const SYSTEM_ROLES = [
  {
    name: 'Super Administrator',
    code: 'SUPER_ADMIN',
    description: 'Complete unrestricted access across all multi-business modules, users, security, and accounting.',
    isSystem: true,
  },
  {
    name: 'Store Manager',
    code: 'MANAGER',
    description: 'Store-level managerial oversight for billing, purchase approvals, stock audits, and party ledgers.',
    isSystem: true,
  },
  {
    name: 'Sales Executive',
    code: 'SALES_USER',
    description: 'Optical counter sales, customer prescription entry, invoice creation, and payment collection.',
    isSystem: true,
  },
  {
    name: 'Purchase Executive',
    code: 'PURCHASE_USER',
    description: 'Supplier orders, frame/lens inward billing, landed cost inspection, and vendor returns.',
    isSystem: true,
  },
  {
    name: 'Inventory Manager',
    code: 'INVENTORY_USER',
    description: 'Barcode generation, physical stock adjustments, lens batch tracking, and min-stock monitoring.',
    isSystem: true,
  },
  {
    name: 'Accounts Executive',
    code: 'ACCOUNTS_USER',
    description: 'Payment settlements, party ledger reconciliation, outstanding aging analysis, and GST reports.',
    isSystem: true,
  },
  {
    name: 'Read-Only Viewer',
    code: 'VIEWER',
    description: 'Read-only access to sales, purchase, stock, customer ledgers, and operational dashboards.',
    isSystem: true,
  },
];

export async function seedInitialDatabase() {
  console.log('[Database Seed] Starting database initialization and seeding...');

  // 1. Run migrations first
  await runMigrations();

  // 2. Insert Permissions if not existing
  console.log('[Database Seed] Seeding granular permissions...');
  for (const perm of SYSTEM_PERMISSIONS) {
    const existing = await db.select().from(permissions).where(eq(permissions.code, perm.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(permissions).values(perm).onConflictDoNothing();
    }
  }
  const allPermissions = await db.select().from(permissions);
  const permissionMap = new Map(allPermissions.map(p => [p.code, p.id]));

  // 3. Insert System Roles if not existing
  console.log('[Database Seed] Seeding standard system roles...');
  for (const roleData of SYSTEM_ROLES) {
    const existing = await db.select().from(roles).where(eq(roles.code, roleData.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(roles).values(roleData).onConflictDoNothing();
    }
  }
  const allRoles = await db.select().from(roles);
  const roleMap = new Map(allRoles.map(r => [r.code, r.id]));

  // 4. Map Permissions to Roles
  console.log('[Database Seed] Mapping role-permission policies...');
  const existingRolePerms = await db.select({
    roleId: rolePermissions.roleId,
    permissionId: rolePermissions.permissionId,
  }).from(rolePermissions);
  const existingRolePermSet = new Set(existingRolePerms.map(rp => `${rp.roleId}_${rp.permissionId}`));

  for (const role of allRoles) {
    let allowedCodes: string[] = [];
    if (role.code === 'SUPER_ADMIN') {
      allowedCodes = SYSTEM_PERMISSIONS.map(p => p.code);
    } else if (role.code === 'MANAGER') {
      allowedCodes = SYSTEM_PERMISSIONS.filter(p => p.code !== 'admin:manage_roles').map(p => p.code);
    } else if (role.code === 'SALES_USER') {
      allowedCodes = ['sales:view', 'sales:create', 'sales:edit', 'sales:export', 'parties:view', 'parties:create', 'parties:edit', 'inventory:view', 'accounts:view', 'accounts:create'];
    } else if (role.code === 'PURCHASE_USER') {
      allowedCodes = ['purchase:view', 'purchase:create', 'purchase:edit', 'purchase:view_purchase_price', 'purchase:export', 'parties:view', 'parties:create', 'inventory:view'];
    } else if (role.code === 'INVENTORY_USER') {
      allowedCodes = ['inventory:view', 'inventory:create', 'inventory:edit', 'inventory:adjust_stock', 'inventory:import', 'inventory:export', 'purchase:view'];
    } else if (role.code === 'ACCOUNTS_USER') {
      allowedCodes = ['accounts:view', 'accounts:create', 'accounts:edit', 'accounts:export', 'parties:view', 'parties:export', 'sales:view', 'purchase:view', 'reports:view', 'reports:export'];
    } else if (role.code === 'VIEWER') {
      allowedCodes = ['sales:view', 'purchase:view', 'inventory:view', 'parties:view', 'accounts:view', 'reports:view'];
    }

    for (const code of allowedCodes) {
      const permId = permissionMap.get(code);
      if (permId) {
        const key = `${role.id}_${permId}`;
        if (!existingRolePermSet.has(key)) {
          await db.insert(rolePermissions).values({
            roleId: role.id,
            permissionId: permId,
          }).onConflictDoNothing();
          existingRolePermSet.add(key);
        }
      }
    }
  }

  // 5. Seed Default Business (Lumina Opticals Pvt Ltd)
  console.log('[Database Seed] Ensuring default Optical Business exists...');
  let defaultBusiness = (await db.select().from(businesses).limit(1))[0];
  if (!defaultBusiness) {
    const [createdBiz] = await db.insert(businesses).values({
      name: 'Lumina Opticals Pvt Ltd',
      tradeName: 'Lumina Vision & Eyewear Care',
      gstin: '27AABCL1234F1Z8',
      pan: 'AABCL1234F',
      email: 'billing@luminaoptical.com',
      phone: '+91 98200 12345',
      addressLine1: '102, Vision Plaza, High Street',
      addressLine2: 'Near Central Optometry Hub',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      pincode: '400001',
      currency: 'INR',
      financialYearStart: '04-01',
      status: 'ACTIVE',
    }).returning();
    defaultBusiness = createdBiz;
  }

  // 6. Seed Default Users with bcrypt hashed passwords
  console.log('[Database Seed] Seeding default administrative & operational users...');
  const usersToSeed = [
    {
      username: 'admin',
      email: 'admin@luminaoptical.com',
      mobile: '9820000001',
      fullName: 'Super Administrator',
      password: 'admin123',
      isSuperAdmin: true,
      roleCode: 'SUPER_ADMIN',
    },
    {
      username: 'manager',
      email: 'manager@luminaoptical.com',
      mobile: '9820000002',
      fullName: 'Branch Manager',
      password: 'manager123',
      isSuperAdmin: false,
      roleCode: 'MANAGER',
    },
    {
      username: 'sales',
      email: 'sales@luminaoptical.com',
      mobile: '9820000003',
      fullName: 'Senior Optician / Sales Executive',
      password: 'sales123',
      isSuperAdmin: false,
      roleCode: 'SALES_USER',
    },
    {
      username: 'accounts',
      email: 'accounts@luminaoptical.com',
      mobile: '9820000004',
      fullName: 'Accounts Officer',
      password: 'accounts123',
      isSuperAdmin: false,
      roleCode: 'ACCOUNTS_USER',
    },
  ];

  for (const u of usersToSeed) {
    let userRecord = (await db.select().from(users).where(eq(users.username, u.username)).limit(1))[0];
    if (!userRecord) {
      const passwordHash = await hashPassword(u.password);
      const [newUser] = await db.insert(users).values({
        username: u.username,
        email: u.email,
        mobile: u.mobile,
        fullName: u.fullName,
        passwordHash,
        status: 'ACTIVE',
        isSuperAdmin: u.isSuperAdmin,
      }).returning();
      userRecord = newUser;
    }

    // Connect user to default business access
    const existingAccess = (await db.select().from(userBusinessAccess)
      .where(and(
        eq(userBusinessAccess.userId, userRecord.id),
        eq(userBusinessAccess.businessId, defaultBusiness.id)
      ))
      .limit(1))[0];
    if (!existingAccess) {
      await db.insert(userBusinessAccess).values({
        userId: userRecord.id,
        businessId: defaultBusiness.id,
        isDefault: true,
      }).onConflictDoNothing();
    }

    // Assign Role in default business
    const roleId = roleMap.get(u.roleCode);
    if (roleId) {
      const existingUserRole = (await db.select().from(userRoles)
        .where(and(
          eq(userRoles.userId, userRecord.id),
          eq(userRoles.businessId, defaultBusiness.id),
          eq(userRoles.roleId, roleId)
        ))
        .limit(1))[0];
      if (!existingUserRole) {
        await db.insert(userRoles).values({
          userId: userRecord.id,
          businessId: defaultBusiness.id,
          roleId,
        }).onConflictDoNothing();
      }
    }
  }

  // 7. Seed Optical Categories (SV, KT, PROG)
  console.log('[Database Seed] Seeding optical categories (SV, KT, PROG)...');
  const standardCategories = [
    { name: 'Single Vision', code: 'SV', description: 'Single vision distance, reading or computer optical lenses.' },
    { name: 'Kryptok Bifocal', code: 'KT', description: 'Traditional fused round-top bifocal optical lenses with reading segment.' },
    { name: 'Progressive Lens', code: 'PROG', description: 'No-line multifocal lenses with smooth progression from distance to near.' },
  ];

  for (const cat of standardCategories) {
    const existing = (await db.select().from(categories).where(and(eq(categories.businessId, defaultBusiness.id), eq(categories.code, cat.code))).limit(1))[0];
    if (!existing) {
      await db.insert(categories).values({
        businessId: defaultBusiness.id,
        name: cat.name,
        code: cat.code,
        description: cat.description,
        status: 'ACTIVE',
      }).onConflictDoNothing();
    }
  }
  const allCategories = await db.select().from(categories).where(eq(categories.businessId, defaultBusiness.id));
  const categoryMap = new Map(allCategories.map(c => [c.code, c.id]));

  // 8. Seed Coatings Master
  console.log('[Database Seed] Seeding optical coatings...');
  const standardCoatings = [
    { name: 'Hard Coat', code: 'HC', description: 'Scratch-resistant hard coating' },
    { name: 'Hard Multi-Coat / Anti-Reflective', code: 'HMC', description: 'Anti-reflective green/blue reflection reduction coating' },
    { name: 'Blue Cut Green', code: 'BCG', description: 'Blue light protection with green reflection reflex' },
    { name: 'Blue Cut Blue', code: 'BCB', description: 'Blue light protection with blue reflection reflex' },
    { name: 'Blue Cut Diamond', code: 'BCD', description: 'Ultra-tough hydrophobic oleophobic blue cut coating' },
    { name: 'Blue Cut Magnet / Satin', code: 'BCM', description: 'Enhanced contrast anti-glare blue cut filter' },
    { name: 'Blue Cut Low Residual Blue', code: 'BCLRB', description: 'Low reflection residual blue cut coating' },
    { name: 'PhotoGrey Hard Coat', code: 'PGHC', description: 'Fast transitions photochromic grey hard coat' },
    { name: 'Blue Cut PhotoGrey Hard Coat', code: 'BCPGHC', description: 'Dual protection blue light block + photochromic grey' },
    { name: 'Polycarbonate Blue Cut Green', code: 'PCBCG', description: 'Impact-resistant polycarbonate index 1.59 + blue cut green' },
    { name: 'Polycarbonate Blue Cut Blue', code: 'PCBCB', description: 'Impact-resistant polycarbonate index 1.59 + blue cut blue' },
    { name: 'Polycarbonate Blue Cut Diamond', code: 'PCBCD', description: 'Impact-resistant polycarbonate + diamond blue shield' },
  ];

  for (const c of standardCoatings) {
    const existing = (await db.select().from(coatings).where(and(eq(coatings.businessId, defaultBusiness.id), eq(coatings.code, c.code))).limit(1))[0];
    if (!existing) {
      await db.insert(coatings).values({
        businessId: defaultBusiness.id,
        name: c.name,
        code: c.code,
        description: c.description,
        status: 'ACTIVE',
      }).onConflictDoNothing();
    }
  }
  const allCoatings = await db.select().from(coatings).where(eq(coatings.businessId, defaultBusiness.id));
  const coatingMap = new Map(allCoatings.map(c => [c.code, c.id]));

  // 9. Seed Bases Master
  console.log('[Database Seed] Seeding optical bases...');
  const standardBases = [
    { name: 'Clear Hard Coat', code: 'HC', family: 'CLEAR', coatingCode: 'HC', description: 'Standard Clear Hard Coated lens base', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Clear Hard Multi-Coat', code: 'HMC', family: 'CLEAR', coatingCode: 'HMC', description: 'Clear Anti-Reflective lens base', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Blue Cut Green', code: 'BCG', family: 'BLUE CUT', coatingCode: 'BCG', description: 'Blue filter with green reflex', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Blue Cut Blue', code: 'BCB', family: 'BLUE CUT', coatingCode: 'BCB', description: 'Blue filter with blue reflex', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Blue Cut Diamond', code: 'BCD', family: 'BLUE CUT', coatingCode: 'BCD', description: 'Blue filter diamond grade', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Blue Cut Magnet', code: 'BCM', family: 'BLUE CUT', coatingCode: 'BCM', description: 'Blue filter satin finish', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Blue Cut Low Residual Blue', code: 'BCLRB', family: 'BLUE CUT', coatingCode: 'BCLRB', description: 'Blue filter low residual reflex', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'PhotoGrey Hard Coat', code: 'PGHC', family: 'PHOTOGREY', coatingCode: 'PGHC', description: 'Photochromic grey base', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Blue Cut PhotoGrey Hard Coat', code: 'BCPGHC', family: 'BLUE CUT PHOTOGREY', coatingCode: 'BCPGHC', description: 'Dual blue light + photochromic grey', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Polycarbonate Blue Cut Green', code: 'PCBCG', family: 'POLY BLUE CUT', coatingCode: 'PCBCG', description: 'Polycarbonate impact resistant blue green', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Polycarbonate Blue Cut Blue', code: 'PCBCB', family: 'POLY BLUE CUT', coatingCode: 'PCBCB', description: 'Polycarbonate impact resistant blue blue', compatibleCats: ['SV', 'KT', 'PROG'] },
    { name: 'Polycarbonate Blue Cut Diamond', code: 'PCBCD', family: 'POLY BLUE CUT', coatingCode: 'PCBCD', description: 'Polycarbonate impact resistant diamond', compatibleCats: ['SV', 'KT', 'PROG'] },
  ];

  for (const b of standardBases) {
    let baseRecord = (await db.select().from(bases).where(and(eq(bases.businessId, defaultBusiness.id), eq(bases.code, b.code))).limit(1))[0];
    if (!baseRecord) {
      const [newBase] = await db.insert(bases).values({
        businessId: defaultBusiness.id,
        name: b.name,
        code: b.code,
        family: b.family,
        coatingId: coatingMap.get(b.coatingCode) || null,
        description: b.description,
        status: 'ACTIVE',
      }).returning();
      baseRecord = newBase;
    }

    // Seed Base Category Compatibility
    for (const catCode of b.compatibleCats) {
      const catId = categoryMap.get(catCode);
      if (catId && baseRecord) {
        const existingBc = (await db.select().from(baseCategories).where(and(
          eq(baseCategories.businessId, defaultBusiness.id),
          eq(baseCategories.baseId, baseRecord.id),
          eq(baseCategories.categoryId, catId)
        )).limit(1))[0];
        if (!existingBc) {
          await db.insert(baseCategories).values({
            businessId: defaultBusiness.id,
            baseId: baseRecord.id,
            categoryId: catId,
          }).onConflictDoNothing();
        }
      }
    }
  }

  // 10. Seed Sample Primary Items & Unique Items
  console.log('[Database Seed] Seeding sample primary items and unique items...');
  const samplePrimaryItems = [
    { code: 'HC_SV', name: 'HC SV (1.56 Hard Coat Single Vision)', catCode: 'SV', baseCode: 'HC', coatingCode: 'HC' },
    { code: 'BCG_SV', name: 'BCG SV (1.56 Blue Cut Green Single Vision)', catCode: 'SV', baseCode: 'BCG', coatingCode: 'BCG' },
    { code: 'BCB_SV', name: 'BCB SV (1.56 Blue Cut Blue Single Vision)', catCode: 'SV', baseCode: 'BCB', coatingCode: 'BCB' },
    { code: 'PGHC_SV', name: 'PG HC SV (PhotoGrey Hard Coat Single Vision)', catCode: 'SV', baseCode: 'PGHC', coatingCode: 'PGHC' },
    { code: 'PGHC_KT', name: 'PG HC KT (PhotoGrey Hard Coat Kryptok Bifocal)', catCode: 'KT', baseCode: 'PGHC', coatingCode: 'PGHC' },
    { code: 'PGHC_PROG', name: 'PG HC PROG (PhotoGrey Hard Coat Progressive Lens)', catCode: 'PROG', baseCode: 'PGHC', coatingCode: 'PGHC' },
  ];

  const allBases = await db.select().from(bases).where(eq(bases.businessId, defaultBusiness.id));
  const baseMap = new Map(allBases.map(b => [b.code, b.id]));

  for (const pItem of samplePrimaryItems) {
    const catId = categoryMap.get(pItem.catCode);
    const baseId = baseMap.get(pItem.baseCode);
    const coatingId = coatingMap.get(pItem.coatingCode);

    if (catId && baseId) {
      let primaryRecord = (await db.select().from(primaryItems).where(and(
        eq(primaryItems.businessId, defaultBusiness.id),
        eq(primaryItems.code, pItem.code)
      )).limit(1))[0];

      if (!primaryRecord) {
        const [createdP] = await db.insert(primaryItems).values({
          businessId: defaultBusiness.id,
          categoryId: catId,
          baseId,
          coatingId: coatingId || null,
          name: pItem.name,
          code: pItem.code,
          status: 'ACTIVE',
        }).returning();
        primaryRecord = createdP;
      }

      // Ensure at least one default Unique Item exists under this Primary Item
      if (primaryRecord) {
        const uniqueItemCode = `${pItem.code}_STD`;
        const existingU = (await db.select().from(uniqueItems).where(and(
          eq(uniqueItems.businessId, defaultBusiness.id),
          eq(uniqueItems.code, uniqueItemCode)
        )).limit(1))[0];

        if (!existingU) {
          await db.insert(uniqueItems).values({
            businessId: defaultBusiness.id,
            primaryItemId: primaryRecord.id,
            name: `${pItem.name} - Standard White Box`,
            code: uniqueItemCode,
            purchaseRate: '120.00',
            lastPurchasePrice: '120.00',
            mrp: '350.00',
            status: 'ACTIVE',
          }).onConflictDoNothing();
        }
      }
    }
  }

  // 11. Record System Initialization Audit Log
  const existingAudit = (await db.select().from(auditLogs).limit(1))[0];
  if (!existingAudit) {
    await db.insert(auditLogs).values({
      businessId: defaultBusiness.id,
      action: 'SYSTEM_INITIALIZATION',
      module: 'SYSTEM',
      entityType: 'SystemBootstrap',
      entityId: defaultBusiness.id,
      newValue: {
        message: 'System initialization, RBAC tables, standard permissions, Optical Master Hierarchy, and default business established.',
        version: '1.0.0',
        businessName: defaultBusiness.name,
      },
    });
  }

  console.log('[Database Seed] Database initialization and seeding completed successfully.');
  return {
    success: true,
    businessId: defaultBusiness.id,
    businessName: defaultBusiness.name,
  };
}

// Standalone execution support via `npm run db:seed`
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedInitialDatabase()
    .then((res) => {
      console.log('Seed success:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
