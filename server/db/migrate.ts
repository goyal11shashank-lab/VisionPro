import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, db } from './index.js';
import { permissions, roles, rolePermissions } from './schema.js';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

let migrationExecuted = false;

export async function runMigrations(): Promise<{ success: boolean; message: string; tablesCount?: number }> {
  try {
    const migrationFile = path.join(__dirname, 'migrations', '0000_initial.sql');
    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found at ${migrationFile}`);
    }

    const sqlContent = fs.readFileSync(migrationFile, 'utf8');
    await pool.query(sqlContent);

    // Seed master permissions & roles if not present
    for (const perm of SYSTEM_PERMISSIONS) {
      const existing = await db.select().from(permissions).where(eq(permissions.code, perm.code)).limit(1);
      if (existing.length === 0) {
        await db.insert(permissions).values(perm);
      }
    }

    const allPerms = await db.select().from(permissions);
    const permMap = new Map(allPerms.map(p => [p.code, p.id]));

    for (const roleData of SYSTEM_ROLES) {
      const existing = await db.select().from(roles).where(eq(roles.code, roleData.code)).limit(1);
      let roleId = existing[0]?.id;
      if (!roleId) {
        const [inserted] = await db.insert(roles).values(roleData).returning();
        roleId = inserted.id;
      }

      // Map role permissions
      let allowedCodes: string[] = [];
      if (roleData.code === 'SUPER_ADMIN') {
        allowedCodes = SYSTEM_PERMISSIONS.map(p => p.code);
      } else if (roleData.code === 'MANAGER') {
        allowedCodes = SYSTEM_PERMISSIONS.filter(p => p.code !== 'admin:manage_roles').map(p => p.code);
      } else if (roleData.code === 'SALES_USER') {
        allowedCodes = ['sales:view', 'sales:create', 'sales:edit', 'sales:export', 'parties:view', 'parties:create', 'parties:edit', 'inventory:view', 'accounts:view', 'accounts:create'];
      } else if (roleData.code === 'PURCHASE_USER') {
        allowedCodes = ['purchase:view', 'purchase:create', 'purchase:edit', 'purchase:view_purchase_price', 'purchase:export', 'parties:view', 'parties:create', 'inventory:view'];
      } else if (roleData.code === 'INVENTORY_USER') {
        allowedCodes = ['inventory:view', 'inventory:create', 'inventory:edit', 'inventory:adjust_stock', 'inventory:import', 'inventory:export', 'purchase:view'];
      } else if (roleData.code === 'ACCOUNTS_USER') {
        allowedCodes = ['accounts:view', 'accounts:create', 'accounts:edit', 'accounts:export', 'parties:view', 'parties:export', 'sales:view', 'purchase:view', 'reports:view', 'reports:export'];
      } else if (roleData.code === 'VIEWER') {
        allowedCodes = ['sales:view', 'purchase:view', 'inventory:view', 'parties:view', 'accounts:view', 'reports:view'];
      }

      for (const code of allowedCodes) {
        const permId = permMap.get(code);
        if (permId && roleId) {
          const existingRp = await db.select().from(rolePermissions)
            .where(eq(rolePermissions.roleId, roleId))
            .limit(100);
          if (!existingRp.some(rp => rp.permissionId === permId)) {
            await db.insert(rolePermissions).values({ roleId, permissionId: permId });
          }
        }
      }
    }

    // Verify created tables
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    const tableNames = tableRes.rows.map(r => r.table_name);
    migrationExecuted = true;
    console.log(`[Migrations] Successfully initialized ${tableNames.length} tables in PostgreSQL:`, tableNames.join(', '));

    return {
      success: true,
      message: `Database migrations executed successfully. ${tableNames.length} tables verified.`,
      tablesCount: tableNames.length,
    };
  } catch (error: any) {
    console.error('[Migrations Error]', error);
    return {
      success: false,
      message: error.message || 'Migration execution failed',
    };
  }
}

/**
 * Ensures migrations have run at least once during application runtime lifecycle
 */
export async function ensureMigrationsRun(): Promise<void> {
  if (!migrationExecuted) {
    await runMigrations();
  }
}

// Standalone execution support via `npm run db:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((res) => {
      console.log(res.message);
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

