import { db, pool } from './index.js';
import { businesses, users, roles, permissions, rolePermissions, userBusinessAccess, userRoles, auditLogs } from './schema.js';
import { hashPassword } from '../auth/password.js';
import { eq } from 'drizzle-orm';
import { runMigrations } from './migrate.js';

export const SYSTEM_PERMISSIONS = [
  // Sales Module
  { module: 'sales', action: 'view', code: 'sales:view', description: 'View sales orders, invoices, and returns' },
  { module: 'sales', action: 'create', code: 'sales:create', description: 'Create new sales orders and invoices' },
  { module: 'sales', action: 'edit', code: 'sales:edit', description: 'Edit pending sales documents' },
  { module: 'sales', action: 'delete', code: 'sales:delete', description: 'Delete draft sales orders' },
  { module: 'sales', action: 'cancel', code: 'sales:cancel', description: 'Cancel finalized sales invoices' },
  { module: 'sales', action: 'approve', code: 'sales:approve', description: 'Approve special discounts or credit limits' },
  { module: 'sales', action: 'export', code: 'sales:export', description: 'Export sales registers and reports' },
  { module: 'sales', action: 'edit_sale_price', code: 'sales:edit_sale_price', description: 'Override default sales price on items' },

  // Purchase Module
  { module: 'purchase', action: 'view', code: 'purchase:view', description: 'View purchase orders, inward bills and returns' },
  { module: 'purchase', action: 'create', code: 'purchase:create', description: 'Record supplier purchase invoices' },
  { module: 'purchase', action: 'edit', code: 'purchase:edit', description: 'Edit purchase records before posting' },
  { module: 'purchase', action: 'delete', code: 'purchase:delete', description: 'Delete draft purchase entries' },
  { module: 'purchase', action: 'cancel', code: 'purchase:cancel', description: 'Cancel approved purchase documents' },
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

  // Administration Module
  { module: 'admin', action: 'manage_users', code: 'admin:manage_users', description: 'Create, update, lock, and assign roles to users' },
  { module: 'admin', action: 'manage_roles', code: 'admin:manage_roles', description: 'Configure custom roles and permission assignments' },
  { module: 'admin', action: 'manage_settings', code: 'admin:manage_settings', description: 'Configure business GST, invoice prefixes, and barcode settings' },
  { module: 'admin', action: 'view_audit_logs', code: 'admin:view_audit_logs', description: 'Inspect audit trails of all system modifications' },
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
      await db.insert(permissions).values(perm);
    }
  }
  const allPermissions = await db.select().from(permissions);
  const permissionMap = new Map(allPermissions.map(p => [p.code, p.id]));

  // 3. Insert System Roles if not existing
  console.log('[Database Seed] Seeding standard system roles...');
  for (const roleData of SYSTEM_ROLES) {
    const existing = await db.select().from(roles).where(eq(roles.code, roleData.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(roles).values(roleData);
    }
  }
  const allRoles = await db.select().from(roles);
  const roleMap = new Map(allRoles.map(r => [r.code, r.id]));

  // 4. Map Permissions to Roles
  console.log('[Database Seed] Mapping role-permission policies...');
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
        const existingRp = await db.select().from(rolePermissions)
          .where(eq(rolePermissions.roleId, role.id))
          .limit(100);
        const hasPerm = existingRp.some(rp => rp.permissionId === permId);
        if (!hasPerm) {
          await db.insert(rolePermissions).values({
            roleId: role.id,
            permissionId: permId,
          });
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
      .where(eq(userBusinessAccess.userId, userRecord.id))
      .limit(10))[0];
    if (!existingAccess) {
      await db.insert(userBusinessAccess).values({
        userId: userRecord.id,
        businessId: defaultBusiness.id,
        isDefault: true,
      });
    }

    // Assign Role in default business
    const roleId = roleMap.get(u.roleCode);
    if (roleId) {
      const existingUserRole = (await db.select().from(userRoles)
        .where(eq(userRoles.userId, userRecord.id))
        .limit(10))[0];
      if (!existingUserRole) {
        await db.insert(userRoles).values({
          userId: userRecord.id,
          businessId: defaultBusiness.id,
          roleId,
        });
      }
    }
  }

  // 7. Record System Initialization Audit Log
  const existingAudit = (await db.select().from(auditLogs).limit(1))[0];
  if (!existingAudit) {
    await db.insert(auditLogs).values({
      businessId: defaultBusiness.id,
      action: 'SYSTEM_INITIALIZATION',
      module: 'SYSTEM',
      entityType: 'SystemBootstrap',
      entityId: defaultBusiness.id,
      newValue: {
        message: 'System initialization, RBAC tables, standard permissions and default business established.',
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
if (process.argv[1] === import.meta.url) {
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
