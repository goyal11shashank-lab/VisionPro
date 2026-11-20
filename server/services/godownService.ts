import { db, pool } from '../db/index.js';
import {
  godowns,
  businesses,
  users,
  roles,
  userRoles,
  userBusinessAccess,
  opticalStocks,
  opticalBatches,
  uniqueItems,
  primaryItems,
  categories,
  parties,
  salesInvoices,
  salesOrders,
  purchaseInvoices,
  purchaseOrders,
  payments,
  stockLedger,
} from '../db/schema.js';
import { eq, and, sql, desc, or, ilike, inArray } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import { AuditService } from './auditService.js';
import { scoreCandidate, SearchCandidate, formatOpticalBatchName } from '../utils/searchNormalization.js';

export interface CreateGodownDTO {
  name: string;
  code?: string;
  godownType?: 'SECONDARY_WAREHOUSE' | 'DEALER_GODOWN';
  address?: string;
  contactPerson?: string;
  mobile?: string;
  dealerPartyId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  enableB2bOrderSync?: boolean;
  syncDirectInvoice?: boolean;
  defaultProcessingPreference?: 'AUTO_ACCEPT' | 'REQUIRES_ACCEPTANCE';
  syncStatus?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateGodownDTO {
  name?: string;
  code?: string;
  godownType?: 'SECONDARY_WAREHOUSE' | 'DEALER_GODOWN';
  address?: string;
  contactPerson?: string;
  mobile?: string;
  dealerPartyId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  enableB2bOrderSync?: boolean;
  syncDirectInvoice?: boolean;
  defaultProcessingPreference?: 'AUTO_ACCEPT' | 'REQUIRES_ACCEPTANCE';
  syncStatus?: 'ACTIVE' | 'INACTIVE';
}

export interface CreateGodownUserDTO {
  username: string;
  password?: string;
  fullName: string;
  email?: string;
  mobile?: string;
  permissionsOverride?: Record<string, boolean>;
}

export interface UpdateGodownUserDTO {
  fullName?: string;
  email?: string;
  mobile?: string;
  password?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  permissionsOverride?: Record<string, boolean>;
}

export class GodownService {
  /**
   * 1. Generate Next Godown Code (e.g. GDN-001, GDN-002)
   */
  static async generateGodownCode(businessId: string): Promise<string> {
    const rows = await db
      .select({ code: godowns.code })
      .from(godowns)
      .where(eq(godowns.businessId, businessId));

    let maxNum = 0;
    for (const r of rows) {
      if (r.code && r.code.startsWith('GDN-')) {
        const num = parseInt(r.code.replace('GDN-', ''), 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const nextSeq = maxNum + 1;
    return `GDN-${String(nextSeq).padStart(3, '0')}`;
  }

  /**
   * 2. List Extra Godowns for Parent Business
   */
  static async listGodowns(businessId: string, options?: { search?: string; status?: string; godownType?: string }) {
    const client = await pool.connect();
    try {
      const search = options?.search?.trim() ? `%${options.search.trim().toLowerCase()}%` : null;
      const status = options?.status?.trim() || null;
      const godownType = options?.godownType?.trim() || null;

      let query = `
        SELECT 
          g.id,
          g.business_id as "businessId",
          g.code,
          g.name,
          g.godown_type as "godownType",
          g.address,
          g.contact_person as "contactPerson",
          g.mobile,
          g.dealer_party_id as "dealerPartyId",
          g.status,
          g.enable_b2b_order_sync as "enableB2bOrderSync",
          g.sync_direct_invoice as "syncDirectInvoice",
          g.default_processing_preference as "defaultProcessingPreference",
          g.sync_status as "syncStatus",
          g.created_at as "createdAt",
          g.updated_at as "updatedAt",
          p.name as "dealerPartyName",
          p.party_code as "dealerPartyCode",
          COUNT(DISTINCT u.id) as "assignedUsersCount"
        FROM godowns g
        LEFT JOIN parties p ON g.dealer_party_id = p.id
        LEFT JOIN users u ON u.assigned_godown_id = g.id
        WHERE g.business_id = $1
      `;
      const params: any[] = [businessId];

      if (status) {
        params.push(status);
        query += ` AND g.status = $${params.length}`;
      }

      if (godownType) {
        params.push(godownType);
        query += ` AND g.godown_type = $${params.length}`;
      }

      if (search) {
        params.push(search);
        query += ` AND (LOWER(g.name) LIKE $${params.length} OR LOWER(g.code) LIKE $${params.length} OR LOWER(COALESCE(g.contact_person, '')) LIKE $${params.length})`;
      }

      query += ` GROUP BY g.id, p.name, p.party_code ORDER BY g.code ASC`;

      const res = await client.query(query, params);
      return res.rows.map(row => ({
        ...row,
        assignedUsersCount: parseInt(row.assignedUsersCount || '0', 10),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * 3. Get Single Godown by ID
   */
  static async getGodownById(businessId: string, godownId: string) {
    const [row] = await db
      .select({
        id: godowns.id,
        businessId: godowns.businessId,
        code: godowns.code,
        name: godowns.name,
        godownType: godowns.godownType,
        address: godowns.address,
        contactPerson: godowns.contactPerson,
        mobile: godowns.mobile,
        dealerPartyId: godowns.dealerPartyId,
        status: godowns.status,
        enableB2bOrderSync: godowns.enableB2bOrderSync,
        syncDirectInvoice: godowns.syncDirectInvoice,
        defaultProcessingPreference: godowns.defaultProcessingPreference,
        syncStatus: godowns.syncStatus,
        createdAt: godowns.createdAt,
        updatedAt: godowns.updatedAt,
      })
      .from(godowns)
      .where(and(eq(godowns.id, godownId), eq(godowns.businessId, businessId)))
      .limit(1);

    if (!row) {
      throw new Error(`Godown with ID ${godownId} not found in this business.`);
    }

    return row;
  }

  /**
   * 4. Create Extra Godown
   */
  static async createGodown(businessId: string, data: CreateGodownDTO, userId?: string) {
    if (!data.name || !data.name.trim()) {
      throw new Error('Godown Name is mandatory.');
    }

    let code = data.code?.trim().toUpperCase();
    if (!code) {
      code = await this.generateGodownCode(businessId);
    }

    // Check code uniqueness within parent business
    const existing = await db
      .select({ id: godowns.id })
      .from(godowns)
      .where(and(eq(godowns.businessId, businessId), eq(godowns.code, code)))
      .limit(1);

    if (existing.length > 0) {
      throw new Error(`A godown with code '${code}' already exists in this business.`);
    }

    const [created] = await db
      .insert(godowns)
      .values({
        businessId,
        code,
        name: data.name.trim(),
        godownType: data.godownType || 'SECONDARY_WAREHOUSE',
        address: data.address?.trim() || null,
        contactPerson: data.contactPerson?.trim() || null,
        mobile: data.mobile?.trim() || null,
        dealerPartyId: data.dealerPartyId || null,
        status: data.status || 'ACTIVE',
        enableB2bOrderSync: data.enableB2bOrderSync ?? false,
        syncDirectInvoice: data.syncDirectInvoice ?? false,
        defaultProcessingPreference: data.defaultProcessingPreference || 'AUTO_ACCEPT',
        syncStatus: data.syncStatus || 'ACTIVE',
        createdBy: userId || null,
      })
      .returning();

    await AuditService.log({
      businessId,
      userId,
      module: 'godown',
      action: 'CREATE_GODOWN',
      entityType: 'Godown',
      entityId: created.id,
      newValue: created,
    });

    return created;
  }

  /**
   * 5. Update Extra Godown Details / Status
   */
  static async updateGodown(businessId: string, godownId: string, data: UpdateGodownDTO, userId?: string) {
    const existing = await this.getGodownById(businessId, godownId);

    const updateFields: any = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) {
      if (!data.name.trim()) throw new Error('Godown Name cannot be empty.');
      updateFields.name = data.name.trim();
    }

    if (data.code !== undefined && data.code.trim()) {
      const code = data.code.trim().toUpperCase();
      if (code !== existing.code) {
        const dupCheck = await db
          .select({ id: godowns.id })
          .from(godowns)
          .where(and(eq(godowns.businessId, businessId), eq(godowns.code, code)))
          .limit(1);

        if (dupCheck.length > 0) {
          throw new Error(`A godown with code '${code}' already exists.`);
        }
        updateFields.code = code;
      }
    }

    if (data.godownType !== undefined) {
      updateFields.godownType = data.godownType;
    }

    if (data.address !== undefined) {
      updateFields.address = data.address?.trim() || null;
    }

    if (data.contactPerson !== undefined) {
      updateFields.contactPerson = data.contactPerson?.trim() || null;
    }

    if (data.mobile !== undefined) {
      updateFields.mobile = data.mobile?.trim() || null;
    }

    if (data.dealerPartyId !== undefined) {
      updateFields.dealerPartyId = data.dealerPartyId || null;
    }

    if (data.status !== undefined) {
      updateFields.status = data.status;
    }

    if (data.enableB2bOrderSync !== undefined) {
      updateFields.enableB2bOrderSync = data.enableB2bOrderSync;
    }

    if (data.syncDirectInvoice !== undefined) {
      updateFields.syncDirectInvoice = data.syncDirectInvoice;
    }

    if (data.defaultProcessingPreference !== undefined) {
      updateFields.defaultProcessingPreference = data.defaultProcessingPreference;
    }

    if (data.syncStatus !== undefined) {
      updateFields.syncStatus = data.syncStatus;
    }

    const [updated] = await db
      .update(godowns)
      .set(updateFields)
      .where(and(eq(godowns.id, godownId), eq(godowns.businessId, businessId)))
      .returning();

    await AuditService.log({
      businessId,
      userId,
      module: 'godown',
      action: 'UPDATE_GODOWN',
      entityType: 'Godown',
      entityId: godownId,
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  /**
   * 6. Safe Deletion / Deactivation Guard
   * Cannot delete godown if vouchers, stock movements, or users exist!
   */
  static async deleteGodown(businessId: string, godownId: string, userId?: string) {
    const existing = await this.getGodownById(businessId, godownId);

    const client = await pool.connect();
    try {
      // 1. Check for sales vouchers
      const salesRes = await client.query(
        `SELECT COUNT(*) as count FROM sales_invoices WHERE godown_id = $1`,
        [godownId]
      );
      if (parseInt(salesRes.rows[0].count, 10) > 0) {
        throw new Error(
          `Cannot delete godown '${existing.name}': It has ${salesRes.rows[0].count} Sales Invoice(s). Please deactivate the godown instead to preserve audit records.`
        );
      }

      // 2. Check for purchase vouchers
      const purRes = await client.query(
        `SELECT COUNT(*) as count FROM purchase_invoices WHERE godown_id = $1`,
        [godownId]
      );
      if (parseInt(purRes.rows[0].count, 10) > 0) {
        throw new Error(
          `Cannot delete godown '${existing.name}': It has ${purRes.rows[0].count} Purchase Invoice(s). Please deactivate the godown instead.`
        );
      }

      // 3. Check for orders
      const orderRes = await client.query(
        `SELECT 
          (SELECT COUNT(*) FROM sales_orders WHERE godown_id = $1) + 
          (SELECT COUNT(*) FROM purchase_orders WHERE godown_id = $1) as count`,
        [godownId]
      );
      if (parseInt(orderRes.rows[0].count, 10) > 0) {
        throw new Error(
          `Cannot delete godown '${existing.name}': It has existing Sales/Purchase orders. Please deactivate the godown instead.`
        );
      }

      // 4. Check for payments
      const payRes = await client.query(
        `SELECT COUNT(*) as count FROM payments WHERE godown_id = $1`,
        [godownId]
      );
      if (parseInt(payRes.rows[0].count, 10) > 0) {
        throw new Error(
          `Cannot delete godown '${existing.name}': It has ${payRes.rows[0].count} payment receipt(s). Please deactivate the godown instead.`
        );
      }

      // 5. Check for stock balances or stock ledger
      const stockRes = await client.query(
        `SELECT 
          (SELECT COUNT(*) FROM optical_stocks WHERE godown_id = $1 AND (physical_stock > 0 OR reserved_stock > 0)) + 
          (SELECT COUNT(*) FROM stock_ledger WHERE godown_id = $1) as count`,
        [godownId]
      );
      if (parseInt(stockRes.rows[0].count, 10) > 0) {
        throw new Error(
          `Cannot delete godown '${existing.name}': It has historical or active inventory balances. Deactivate the godown to maintain inventory audit trail.`
        );
      }

      // 6. Check for assigned users
      const userRes = await client.query(
        `SELECT COUNT(*) as count FROM users WHERE assigned_godown_id = $1`,
        [godownId]
      );
      if (parseInt(userRes.rows[0].count, 10) > 0) {
        throw new Error(
          `Cannot delete godown '${existing.name}': There are ${userRes.rows[0].count} assigned staff login account(s). Please reassign or delete the users first, or deactivate the godown.`
        );
      }

      // Clean deletion
      await client.query(`DELETE FROM godowns WHERE id = $1 AND business_id = $2`, [godownId, businessId]);

      await AuditService.log({
        businessId,
        userId,
        module: 'godown',
        action: 'DELETE_GODOWN',
        entityType: 'Godown',
        entityId: godownId,
        previousValue: existing,
      });

      return { success: true, message: `Godown '${existing.name}' (${existing.code}) deleted successfully.` };
    } finally {
      client.release();
    }
  }

  /**
   * 7. Create Restricted Godown Staff Login
   * Assigns role SALESMAN, linked to specific godown and parent business.
   */
  static async createGodownUser(
    businessId: string,
    godownId: string,
    data: CreateGodownUserDTO,
    adminUserId: string = 'system'
  ) {
    const godown = await this.getGodownById(businessId, godownId);
    if (godown.status !== 'ACTIVE') {
      throw new Error(`Cannot assign staff to inactive godown '${godown.name}'. Please activate it first.`);
    }

    if (!data.username || !data.username.trim()) {
      throw new Error('Username is mandatory for Godown staff login.');
    }
    const username = data.username.trim().toLowerCase();
    const password = data.password?.trim() || 'salesman123';
    const passwordHash = await hashPassword(password);

    // Check username uniqueness
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUser.length > 0) {
      throw new Error(`Username '${username}' is already taken.`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert user with assigned_godown_id
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validAdminId = adminUserId && isUuid.test(adminUserId) ? adminUserId : null;

      const insertUserRes = await client.query(
        `INSERT INTO users (
          username, full_name, email, mobile, password_hash, status, is_super_admin, assigned_godown_id, user_permissions_override, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', false, $6, $7, $8, NOW(), NOW())
        RETURNING id, username, full_name as "fullName", email, mobile, status, assigned_godown_id as "assignedGodownId", created_at as "createdAt"`,
        [
          username,
          data.fullName?.trim() || `Staff - ${godown.name}`,
          data.email?.trim() || null,
          data.mobile?.trim() || null,
          passwordHash,
          godownId,
          JSON.stringify(data.permissionsOverride || {}),
          validAdminId,
        ]
      );
      const newUser = insertUserRes.rows[0];

      // 2. Assign User Business Access to parent business
      await client.query(
        `INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT DO NOTHING`,
        [newUser.id, businessId]
      );

      // 3. Find or create SALESMAN role for this business
      let roleRes = await client.query(
        `SELECT id FROM roles WHERE code = 'SALESMAN' AND (business_id = $1 OR is_system = true) LIMIT 1`,
        [businessId]
      );

      let salesmanRoleId: string;
      if (roleRes.rows.length > 0) {
        salesmanRoleId = roleRes.rows[0].id;
      } else {
        const createRoleRes = await client.query(
          `INSERT INTO roles (name, code, description, is_system, created_at, updated_at)
           VALUES ('Godown Salesman', 'SALESMAN', 'Operational staff for Extra Godown', true, NOW(), NOW())
           RETURNING id`
        );
        salesmanRoleId = createRoleRes.rows[0].id;
      }

      // 4. Assign role
      await client.query(
        `INSERT INTO user_roles (user_id, business_id, role_id, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT DO NOTHING`,
        [newUser.id, businessId, salesmanRoleId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId: validAdminId || undefined,
        module: 'godown',
        action: 'CREATE_GODOWN_STAFF',
        entityType: 'User',
        entityId: newUser.id,
        newValue: {
          username: newUser.username,
          fullName: newUser.fullName,
          assignedGodownId: godownId,
          godownName: godown.name,
        },
      });

      return newUser;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 8. List Staff Assigned to a Godown
   */
  static async listGodownUsers(businessId: string, godownId: string) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT 
          u.id, 
          u.username, 
          u.full_name as "fullName", 
          u.email, 
          u.mobile, 
          u.status, 
          u.assigned_godown_id as "assignedGodownId",
          u.user_permissions_override as "permissionsOverride",
          u.last_login_at as "lastLoginAt",
          u.created_at as "createdAt"
         FROM users u
         WHERE u.assigned_godown_id = $1
         ORDER BY u.created_at DESC`,
        [godownId]
      );
      return res.rows;
    } finally {
      client.release();
    }
  }

  /**
   * 9. Update Godown User (Reset Password, Change Status, Update Permissions)
   */
  static async updateGodownUser(
    businessId: string,
    godownId: string,
    targetUserId: string,
    updates: UpdateGodownUserDTO,
    adminUserId: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `SELECT id, username, full_name, status, assigned_godown_id, user_permissions_override 
         FROM users 
         WHERE id = $1 AND assigned_godown_id = $2`,
        [targetUserId, godownId]
      );

      if (userRes.rows.length === 0) {
        throw new Error(`Staff user not found in this godown.`);
      }

      const existingUser = userRes.rows[0];
      const queryParts: string[] = ['updated_at = NOW()'];
      const params: any[] = [targetUserId];

      if (updates.fullName !== undefined) {
        params.push(updates.fullName.trim());
        queryParts.push(`full_name = $${params.length}`);
      }
      if (updates.email !== undefined) {
        params.push(updates.email?.trim() || null);
        queryParts.push(`email = $${params.length}`);
      }
      if (updates.mobile !== undefined) {
        params.push(updates.mobile?.trim() || null);
        queryParts.push(`mobile = $${params.length}`);
      }
      if (updates.status !== undefined) {
        params.push(updates.status);
        queryParts.push(`status = $${params.length}`);
      }
      if (updates.password && updates.password.trim()) {
        const hash = await hashPassword(updates.password.trim());
        params.push(hash);
        queryParts.push(`password_hash = $${params.length}`);
      }
      if (updates.permissionsOverride !== undefined) {
        params.push(JSON.stringify(updates.permissionsOverride));
        queryParts.push(`user_permissions_override = $${params.length}`);
      }

      const updateQuery = `
        UPDATE users 
        SET ${queryParts.join(', ')} 
        WHERE id = $1 
        RETURNING id, username, full_name as "fullName", email, mobile, status, assigned_godown_id as "assignedGodownId", user_permissions_override as "permissionsOverride", updated_at as "updatedAt"
      `;

      const result = await client.query(updateQuery, params);
      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId: adminUserId,
        module: 'godown',
        action: 'UPDATE_GODOWN_STAFF',
        entityType: 'User',
        entityId: targetUserId,
        previousValue: existingUser,
        newValue: result.rows[0],
      });

      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 10. Legacy raw-stock inspection for intentional Super Admin use only.
   * Ordinary users use exact item/power booleans, never this quantity feed.
   */
  static async searchMainWarehouseStock(
    mainBusinessId: string,
    options?: {
      query?: string;
      categoryId?: string;
      power?: string;
      sph?: string | number;
      cyl?: string | number;
      axis?: string | number;
      add?: string | number;
      side?: string;
      limit?: number;
      offset?: number;
      isSuperAdmin?: boolean;
    }
  ) {
    if (!options?.isSuperAdmin) throw new Error('Raw cross-business stock inspection requires Super Administrator authority.');
    const client = await pool.connect();
    try {
      const limit = Math.min(options?.limit ? parseInt(String(options.limit), 10) : 50, 100);
      const offset = options?.offset ? parseInt(String(options.offset), 10) : 0;
      const query = (options?.query || '').trim();

      // Only query stocks where business_id = mainBusinessId AND godown_id IS NULL (Main Warehouse)
      let sqlQuery = `
        SELECT 
          b.id as "batchId",
          b.barcode,
          b.identity_key as "identityKey",
          b.sph,
          b.cyl,
          b.axis,
          b.add,
          b.side,
          u.name as "stockItemName",
          u.code as "stockItemCode",
          u.optical_category as "opticalCategory",
          u.unit,
          c.name as "categoryName",
          COALESCE(s.physical_stock, 0.00) as "physicalStock",
          COALESCE(s.reserved_stock, 0.00) as "reservedStock",
          COALESCE(s.available_stock, 0.00) as "availableStock"
        FROM optical_batches b
        INNER JOIN unique_items u ON b.unique_item_id = u.id
        INNER JOIN categories c ON b.category_id = c.id
        LEFT JOIN optical_stocks s ON s.batch_id = b.id AND s.business_id = $1 AND s.godown_id IS NULL
        WHERE b.business_id = $1 AND b.status = 'ACTIVE'
      `;
      const params: any[] = [mainBusinessId];

      if (options?.categoryId) {
        params.push(options.categoryId);
        sqlQuery += ` AND b.category_id = $${params.length}`;
      }

      if (options?.sph !== undefined && options.sph !== '') {
        const sNum = parseFloat(String(options.sph));
        if (!isNaN(sNum)) {
          params.push(sNum);
          sqlQuery += ` AND b.sph = $${params.length}`;
        }
      }

      if (options?.cyl !== undefined && options.cyl !== '') {
        const cNum = parseFloat(String(options.cyl));
        if (!isNaN(cNum)) {
          params.push(cNum);
          sqlQuery += ` AND b.cyl = $${params.length}`;
        }
      }

      if (options?.side && options.side !== 'ALL' && options.side !== 'NONE') {
        params.push(options.side);
        sqlQuery += ` AND b.side = $${params.length}`;
      }

      sqlQuery += ` ORDER BY u.name ASC, b.sph ASC, b.cyl ASC LIMIT 250`;

      const res = await client.query(sqlQuery, params);

      // Map rows and apply intelligent scoring and power normalization if query provided
      let results = res.rows.map(row => {
        const sphNum = parseFloat(row.sph);
        const cylNum = parseFloat(row.cyl);
        const axisNum = parseFloat(row.axis);
        const addNum = parseFloat(row.add);
        const batchName = formatOpticalBatchName({
          sph: sphNum,
          cyl: cylNum,
          axis: axisNum,
          add: addNum,
          side: row.side,
        });

        return {
          batchId: row.batchId,
          barcode: row.barcode,
          identityKey: row.identityKey,
          stockItemName: row.stockItemName,
          stockItemCode: row.stockItemCode,
          opticalCategory: row.opticalCategory,
          unit: row.unit || 'PRS',
          categoryName: row.categoryName,
          batchName,
          sph: sphNum,
          cyl: cylNum,
          axis: axisNum,
          add: addNum,
          side: row.side,
          physicalStock: parseFloat(row.physicalStock || '0'),
          reservedStock: parseFloat(row.reservedStock || '0'),
          availableStock: parseFloat(row.availableStock || '0'),
        };
      });

      if (query) {
        const scored = results.map(item => {
          const candidate: SearchCandidate = {
            id: item.batchId,
            name: `${item.stockItemName} ${item.batchName}`,
            code: item.stockItemCode,
            barcode: item.barcode,
            sph: item.sph,
            cyl: item.cyl,
            axis: item.axis,
            add: item.add,
            side: item.side,
          };
          const score = scoreCandidate(candidate, query);
          return { item, score };
        });

        scored.sort((a, b) => b.score - a.score);
        results = scored.filter(s => s.score > 0).map(s => s.item);
      }

      const total = results.length;
      const paginated = results.slice(offset, offset + limit);

      return {
        total,
        limit,
        offset,
        items: paginated,
        source: 'MAIN_WAREHOUSE_READ_ONLY',
      };
    } finally {
      client.release();
    }
  }

  /**
   * 11. Godown Stock Balance & Consolidation Overview
   */
  static async getGodownStockBalance(
    businessId: string,
    options?:
      | string
      | {
          godownId?: string | null;
          search?: string;
          limit?: number;
          offset?: number;
        }
  ) {
    const opts = typeof options === 'string' ? { godownId: options } : options || {};
    const client = await pool.connect();
    try {
      const limit = Math.min(opts?.limit ? parseInt(String(opts.limit), 10) : 50, 200);
      const offset = opts?.offset ? parseInt(String(opts.offset), 10) : 0;
      const search =
        opts?.search && typeof opts.search === 'string' && opts.search.trim()
          ? `%${opts.search.trim().toLowerCase()}%`
          : null;

      let query = `
        SELECT 
          s.id as "stockId",
          s.business_id as "businessId",
          s.godown_id as "godownId",
          COALESCE(g.name, 'Main Warehouse') as "locationName",
          COALESCE(g.code, 'MAIN') as "locationCode",
          COALESCE(g.godown_type, 'MAIN_WAREHOUSE') as "locationType",
          b.id as "batchId",
          b.barcode,
          b.sph,
          b.cyl,
          b.axis,
          b.add,
          b.side,
          u.id as "uniqueItemId",
          u.name as "stockItemName",
          u.code as "stockItemCode",
          u.optical_category as "opticalCategory",
          u.unit,
          c.name as "categoryName",
          s.physical_stock as "physicalStock",
          s.reserved_stock as "reservedStock",
          s.available_stock as "availableStock",
          s.updated_at as "updatedAt"
        FROM optical_stocks s
        INNER JOIN optical_batches b ON s.batch_id = b.id
        INNER JOIN unique_items u ON b.unique_item_id = u.id
        INNER JOIN categories c ON b.category_id = c.id
        LEFT JOIN godowns g ON s.godown_id = g.id
        WHERE s.business_id = $1
      `;
      const params: any[] = [businessId];

      if (opts?.godownId !== undefined) {
        if (opts.godownId === null || opts.godownId === 'MAIN' || opts.godownId === 'main') {
          query += ` AND s.godown_id IS NULL`;
        } else {
          params.push(opts.godownId);
          query += ` AND s.godown_id = $${params.length}`;
        }
      }

      if (search) {
        params.push(search);
        query += ` AND (LOWER(u.name) LIKE $${params.length} OR LOWER(u.code) LIKE $${params.length} OR LOWER(b.barcode) LIKE $${params.length})`;
      }

      query += ` ORDER BY u.name ASC, b.sph ASC, b.cyl ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const res = await client.query(query, params);

      return res.rows.map(row => {
        const sphNum = parseFloat(row.sph);
        const cylNum = parseFloat(row.cyl);
        const axisNum = parseFloat(row.axis);
        const addNum = parseFloat(row.add);

        return {
          stockId: row.stockId,
          businessId: row.businessId,
          godownId: row.godownId,
          locationName: row.locationName,
          locationCode: row.locationCode,
          locationType: row.locationType,
          batchId: row.batchId,
          barcode: row.barcode,
          stockItemName: row.stockItemName,
          stockItemCode: row.stockItemCode,
          opticalCategory: row.opticalCategory,
          unit: row.unit || 'PRS',
          categoryName: row.categoryName,
          batchName: formatOpticalBatchName({
            sph: sphNum,
            cyl: cylNum,
            axis: axisNum,
            add: addNum,
            side: row.side,
          }),
          sph: sphNum,
          cyl: cylNum,
          axis: axisNum,
          add: addNum,
          side: row.side,
          physicalStock: parseFloat(row.physicalStock || '0'),
          reservedStock: parseFloat(row.reservedStock || '0'),
          availableStock: parseFloat(row.availableStock || '0'),
          updatedAt: row.updatedAt,
        };
      });
    } finally {
      client.release();
    }
  }
}
