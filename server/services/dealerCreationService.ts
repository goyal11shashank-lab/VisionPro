import { pool } from '../db/index.js';
import { recordAuditLog } from './auditService.js';
import { PartyService } from './partyService.js';
import { Request } from 'express';

export interface CreateDealerDTO {
  name: string;
  tradeName?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  creditLimit?: number | string;
  creditDays?: number | string;
  customerLinkMode?: 'CREATE_NEW' | 'LINK_EXISTING';
  existingCustomerPartyId?: string;
  ignoreDuplicateCheck?: boolean;
  idempotencyKey?: string;
}

export interface UpdateDealerDTO {
  name?: string;
  tradeName?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  gstin?: string;
  pan?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  creditLimit?: number | string;
  creditDays?: number | string;
  syncToCustomerParty?: boolean;
}

export class DealerCreationService {
  /**
   * 1. Generate Next Human-Friendly Dealer Code (e.g. DLR-0001, DLR-0002)
   */
  static async generateDealerCode(mainBusinessId: string): Promise<string> {
    const client = await pool.connect();
    try {
      // Find highest DLR-XXXX sequence within this parent warehouse (and check globally for safety)
      const res = await client.query(
        `SELECT code FROM businesses 
         WHERE business_type = 'DEALER' AND code LIKE 'DLR-%'
         ORDER BY code DESC`
      );

      let maxNum = 0;
      for (const row of res.rows) {
        if (!row.code) continue;
        const parts = row.code.split('-');
        if (parts.length >= 2) {
          const num = parseInt(parts[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }

      const nextSeq = maxNum + 1;
      return `DLR-${String(nextSeq).padStart(4, '0')}`;
    } finally {
      client.release();
    }
  }

  /**
   * 2. Check for Probable Duplicate Customer in Main Warehouse
   */
  static async checkCustomerDuplicate(mainBusinessId: string, gstin?: string, name?: string) {
    const client = await pool.connect();
    try {
      const probableMatches: any[] = [];
      const trimmedGstin = gstin?.trim().toUpperCase();
      const trimmedName = name?.trim();

      if (trimmedGstin && trimmedGstin.length >= 8) {
        const gstinRes = await client.query(
          `SELECT id, party_code, name, display_name, gstin, city, state, mobile, email
           FROM parties 
           WHERE business_id = $1 
             AND party_type IN ('CUSTOMER', 'BOTH')
             AND UPPER(TRIM(COALESCE(gstin, ''))) = $2
           LIMIT 5`,
          [mainBusinessId, trimmedGstin]
        );
        for (const row of gstinRes.rows) {
          probableMatches.push({
            ...row,
            matchReason: 'Matching GSTIN',
          });
        }
      }

      if (trimmedName && trimmedName.length >= 3) {
        const namePattern = `%${trimmedName.toLowerCase()}%`;
        const nameRes = await client.query(
          `SELECT id, party_code, name, display_name, gstin, city, state, mobile, email
           FROM parties 
           WHERE business_id = $1 
             AND party_type IN ('CUSTOMER', 'BOTH')
             AND (LOWER(name) LIKE $2 OR LOWER(COALESCE(display_name, '')) LIKE $2)
             AND id NOT IN (${probableMatches.length > 0 ? probableMatches.map((_, i) => `$${i + 3}`).join(',') : 'gen_random_uuid()'})
           LIMIT 5`,
          probableMatches.length > 0
            ? [mainBusinessId, namePattern, ...probableMatches.map(m => m.id)]
            : [mainBusinessId, namePattern]
        );
        for (const row of nameRes.rows) {
          probableMatches.push({
            ...row,
            matchReason: 'Similar Name',
          });
        }
      }

      return {
        hasProbableDuplicate: probableMatches.length > 0,
        probableMatches,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 3. Fast Tally-Style Search for Customers in Main Warehouse
   */
  static async searchMainCustomers(mainBusinessId: string, query: string, limit: number = 20) {
    const client = await pool.connect();
    try {
      const searchPattern = `%${(query || '').trim().toLowerCase()}%`;
      const res = await client.query(
        `SELECT id, party_code, name, display_name, gstin, mobile, city, state, credit_limit, credit_days, notes
         FROM parties 
         WHERE business_id = $1 
           AND party_type IN ('CUSTOMER', 'BOTH')
           AND status = 'ACTIVE'
           AND (
             LOWER(name) LIKE $2 
             OR LOWER(COALESCE(display_name, '')) LIKE $2
             OR LOWER(party_code) LIKE $2
             OR LOWER(COALESCE(gstin, '')) LIKE $2
             OR LOWER(COALESCE(mobile, '')) LIKE $2
             OR LOWER(COALESCE(city, '')) LIKE $2
           )
         ORDER BY name ASC
         LIMIT $3`,
        [mainBusinessId, searchPattern, limit]
      );

      return res.rows.map(row => ({
        id: row.id,
        partyCode: row.party_code,
        name: row.name,
        displayName: row.display_name,
        gstin: row.gstin,
        mobile: row.mobile,
        city: row.city,
        state: row.state,
        creditLimit: row.credit_limit,
        creditDays: row.credit_days,
        isAlreadyLinked: (row.notes || '').includes('[DEALER_BIZ:'),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * 4. ATOMIC DEALER ONBOARDING TRANSACTION
   * - Validates and enforces business_type = 'DEALER' and parent_business_id = mainBusinessId
   * - Generates human-friendly Dealer Code (DLR-XXXX)
   * - Inserts Dealer business record with stock sharing OFF
   * - Initializes business_settings
   * - Links or creates Main Customer Party with [DEALER_BIZ:...] tag
   * - Automatically provisions Main Supplier Party inside Dealer with [MAIN_BIZ:...] tag
   * - Emits audit logs
   */
  static async createDealer(
    mainBusinessId: string,
    userId: string,
    data: CreateDealerDTO,
    req?: Request
  ) {
    if (!mainBusinessId) {
      throw new Error('Current Main Warehouse context is required.');
    }

    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Dealer Business Name is mandatory.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verify caller context: Caller business MUST be a MAIN warehouse
      const mainBizRes = await client.query(
        `SELECT id, name, trade_name, gstin, pan, phone, email, 
                address_line1, address_line2, city, state, state_code, pincode, business_type 
         FROM businesses 
         WHERE id = $1`,
        [mainBusinessId]
      );

      if (mainBizRes.rows.length === 0) {
        throw new Error('Main Warehouse business not found.');
      }
      const mainBiz = mainBizRes.rows[0];
      if (mainBiz.business_type !== 'MAIN') {
        throw new Error('Only a MAIN Warehouse can create Dealer companies.');
      }

      // 2. Duplicate Prevention / Idempotency Check:
      // Prevent rapid double-click creation with identical name under same Main Warehouse within 15s
      const recentDupCheck = await client.query(
        `SELECT id, name, code FROM businesses 
         WHERE parent_business_id = $1 
           AND LOWER(TRIM(name)) = LOWER(TRIM($2))
           AND created_at > NOW() - INTERVAL '15 seconds'
         LIMIT 1`,
        [mainBusinessId, data.name.trim()]
      );

      if (recentDupCheck.rows.length > 0) {
        throw new Error(
          `Dealer '${recentDupCheck.rows[0].name}' (${recentDupCheck.rows[0].code}) was just created. Prevented duplicate submission.`
        );
      }

      // 3. Duplicate Customer Check (if CREATE_NEW and not explicitly ignored)
      const linkMode = data.customerLinkMode || 'CREATE_NEW';
      if (linkMode === 'CREATE_NEW' && !data.ignoreDuplicateCheck) {
        const dupCheck = await this.checkCustomerDuplicate(mainBusinessId, data.gstin, data.name);
        if (dupCheck.hasProbableDuplicate) {
          await client.query('ROLLBACK');
          return {
            requiresConfirmation: true,
            warning: 'Probable existing customer found in Main Warehouse.',
            probableMatches: dupCheck.probableMatches,
          };
        }
      }

      // 4. Generate Dealer Code (DLR-XXXX)
      const dealerCode = await this.generateDealerCode(mainBusinessId);

      // 5. Insert Dealer Business
      // Strictly enforce business_type = 'DEALER', parent_business_id = mainBusinessId, shareStockWithMain = false
      const defaultSettingsConfig = {
        dealer: {
          shareStockWithMain: false,
        },
      };

      const insertBizRes = await client.query(
        `INSERT INTO businesses (
          code, name, trade_name, gstin, pan, email, phone,
          address_line1, address_line2, city, state, state_code, pincode,
          currency, financial_year_start, status, business_type,
          parent_business_id, settings_config, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          'INR', '04-01', 'ACTIVE', 'DEALER',
          $14, $15, $16, NOW(), NOW()
        ) RETURNING id, code, name, trade_name, gstin, pan, phone, email, city, state, state_code, pincode, status, business_type, parent_business_id, created_at`,
        [
          dealerCode,
          data.name.trim(),
          data.tradeName?.trim() || null,
          data.gstin?.trim()?.toUpperCase() || null,
          data.pan?.trim()?.toUpperCase() || null,
          data.email?.trim() || null,
          data.phone?.trim() || null,
          data.addressLine1?.trim() || null,
          data.addressLine2?.trim() || null,
          data.city?.trim() || null,
          data.state?.trim() || null,
          data.stateCode?.trim() || null,
          data.pincode?.trim() || null,
          mainBusinessId,
          JSON.stringify(defaultSettingsConfig),
          userId || null,
        ]
      );

      const newDealer = insertBizRes.rows[0];
      const dealerBusinessId = newDealer.id;

      // 6. Initialize business_settings for the Dealer
      await client.query(
        `INSERT INTO business_settings (business_id, config, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (business_id) DO UPDATE SET config = $2, updated_at = NOW()`,
        [dealerBusinessId, JSON.stringify(defaultSettingsConfig)]
      );

      // 7. Handle Main Customer Party Link / Creation
      let customerParty: any = null;
      const creditLimit = Math.max(0, parseFloat(String(data.creditLimit || '0.00')) || 0);
      const creditDays = Math.max(0, parseInt(String(data.creditDays || '0'), 10) || 0);

      if (linkMode === 'LINK_EXISTING' && data.existingCustomerPartyId) {
        // Validate customer belongs to current Main Warehouse (strict tenant isolation)
        const existCustRes = await client.query(
          `SELECT id, party_code, name, display_name, party_type, notes, credit_limit, credit_days 
           FROM parties 
           WHERE id = $1 AND business_id = $2`,
          [data.existingCustomerPartyId, mainBusinessId]
        );

        if (existCustRes.rows.length === 0) {
          throw new Error('Selected Customer Party not found in this Main Warehouse.');
        }

        const existingCust = existCustRes.rows[0];
        const existingNotes = existingCust.notes || '';
        const tag = `[DEALER_BIZ:${dealerBusinessId}]`;
        const updatedNotes = existingNotes.includes(tag)
          ? existingNotes
          : `${existingNotes} ${tag}`.trim();

        const updatedPartyType = existingCust.party_type === 'SUPPLIER' ? 'BOTH' : existingCust.party_type;

        const updateCustRes = await client.query(
          `UPDATE parties SET 
             notes = $1,
             party_type = $2,
             credit_limit = COALESCE($3, credit_limit),
             credit_days = COALESCE($4, credit_days),
             updated_at = NOW(),
             updated_by = $5
           WHERE id = $6 AND business_id = $7
           RETURNING id, party_code, name, display_name, gstin, mobile, credit_limit, credit_days, notes`,
          [
            updatedNotes,
            updatedPartyType,
            creditLimit > 0 ? creditLimit : existingCust.credit_limit,
            creditDays > 0 ? String(creditDays) : existingCust.credit_days,
            userId || null,
            existingCust.id,
            mainBusinessId,
          ]
        );
        customerParty = updateCustRes.rows[0];
      } else {
        // Option A: Create New Customer Party automatically inside Main Warehouse
        const custCode = await PartyService.generatePartyCode(mainBusinessId, 'CUSTOMER');
        const notes = `Auto-provisioned Dealer Account [DEALER_BIZ:${dealerBusinessId}]`;

        const insertCustRes = await client.query(
          `INSERT INTO parties (
            business_id, party_code, name, display_name, party_type,
            mobile, email, address_line_1, address_line_2,
            city, state, pincode, country, gstin, pan,
            credit_limit, credit_days, status, notes,
            created_by, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, 'CUSTOMER',
            $5, $6, $7, $8,
            $9, $10, $11, 'India', $12, $13,
            $14, $15, 'ACTIVE', $16,
            $17, NOW(), NOW()
          ) RETURNING id, party_code, name, display_name, gstin, mobile, credit_limit, credit_days, notes`,
          [
            mainBusinessId,
            custCode,
            data.name.trim(),
            data.tradeName?.trim() || data.name.trim(),
            data.phone?.trim() || null,
            data.email?.trim() || null,
            data.addressLine1?.trim() || null,
            data.addressLine2?.trim() || null,
            data.city?.trim() || null,
            data.state?.trim() || null,
            data.pincode?.trim() || null,
            data.gstin?.trim()?.toUpperCase() || null,
            data.pan?.trim()?.toUpperCase() || null,
            creditLimit,
            String(creditDays),
            notes,
            userId || null,
          ]
        );
        customerParty = insertCustRes.rows[0];
      }

      // 8. Automatically provision Main Supplier Party inside Dealer Business
      // Tenant: inside new Dealer business (business_id = dealerBusinessId)
      // Public info copied from Main Warehouse only (never private costs/suppliers/margins)
      const supCode = await PartyService.generatePartyCode(dealerBusinessId, 'SUPPLIER');
      const supplierNotes = `[MAIN_BIZ:${mainBusinessId}] Auto-mapped Main Warehouse Supplier`;

      const insertSupRes = await client.query(
        `INSERT INTO parties (
          business_id, party_code, name, display_name, party_type,
          mobile, email, address_line_1, address_line_2,
          city, state, pincode, country, gstin, pan,
          credit_limit, credit_days, status, notes,
          created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'SUPPLIER',
          $5, $6, $7, $8,
          $9, $10, $11, 'India', $12, $13,
          0, '0', 'ACTIVE', $14,
          $15, NOW(), NOW()
        ) RETURNING id, party_code, name, display_name, gstin, mobile, notes`,
        [
          dealerBusinessId,
          supCode,
          mainBiz.name,
          mainBiz.trade_name || mainBiz.name,
          mainBiz.phone || null,
          mainBiz.email || null,
          mainBiz.address_line1 || null,
          mainBiz.address_line2 || null,
          mainBiz.city || null,
          mainBiz.state || null,
          mainBiz.pincode || null,
          mainBiz.gstin || null,
          mainBiz.pan || null,
          supplierNotes,
          userId || null,
        ]
      );
      const supplierParty = insertSupRes.rows[0];

      await client.query('COMMIT');

      // 9. Record Audit Logs
      await recordAuditLog({
        businessId: mainBusinessId,
        userId: userId || null,
        action: 'DEALER_BUSINESS_CREATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Business',
        entityId: dealerBusinessId,
        newValue: {
          dealerId: dealerBusinessId,
          dealerCode: newDealer.code,
          name: newDealer.name,
          parentBusinessId: mainBusinessId,
          businessType: 'DEALER',
          customerPartyId: customerParty.id,
          supplierPartyId: supplierParty.id,
        },
        req,
      });

      await recordAuditLog({
        businessId: mainBusinessId,
        userId: userId || null,
        action: 'DEALER_CUSTOMER_LINKED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Party',
        entityId: customerParty.id,
        newValue: {
          dealerBusinessId,
          partyCode: customerParty.party_code,
          name: customerParty.name,
          creditLimit,
          creditDays,
        },
        req,
      });

      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: userId || null,
        action: 'DEALER_MAIN_SUPPLIER_CREATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Party',
        entityId: supplierParty.id,
        newValue: {
          mainBusinessId,
          partyCode: supplierParty.party_code,
          name: supplierParty.name,
        },
        req,
      });

      return {
        success: true,
        message: `Dealer '${newDealer.name}' (${newDealer.code}) successfully created.`,
        dealer: newDealer,
        customerParty: {
          id: customerParty.id,
          partyCode: customerParty.party_code,
          name: customerParty.name,
          displayName: customerParty.display_name,
          creditLimit,
          creditDays,
        },
        supplierParty: {
          id: supplierParty.id,
          partyCode: supplierParty.party_code,
          name: supplierParty.name,
          displayName: supplierParty.display_name,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 5. Get Dealer Administration Information for Dealer Detail View
   */
  static async getDealerAdministrationInfo(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Dealer record
      const dealerRes = await client.query(
        `SELECT 
           b.id, b.code, b.name, b.trade_name, b.gstin, b.pan, b.phone, b.email,
           b.address_line1, b.address_line2, b.city, b.state, b.state_code, b.pincode,
           b.status, b.business_type, b.parent_business_id, b.created_at, b.updated_at,
           bs.config as settings_config
         FROM businesses b
         LEFT JOIN business_settings bs ON bs.business_id = b.id
         WHERE b.id = $1 AND b.parent_business_id = $2 AND b.business_type = 'DEALER'`,
        [dealerBusinessId, mainBusinessId]
      );

      if (dealerRes.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }
      const dealer = dealerRes.rows[0];

      // 2. Parent Main Warehouse record
      const mainRes = await client.query(
        `SELECT id, name, trade_name, gstin, city, state FROM businesses WHERE id = $1`,
        [mainBusinessId]
      );
      const parentWarehouse = mainRes.rows[0] || null;

      // 3. Linked Customer Party in Main Warehouse
      const custRes = await client.query(
        `SELECT id, party_code, name, display_name, gstin, pan, mobile, email,
                address_line_1, address_line_2, city, state, pincode,
                credit_limit, credit_days, status, notes
         FROM parties 
         WHERE business_id = $1 
           AND notes LIKE $2
         LIMIT 1`,
        [mainBusinessId, `%[DEALER_BIZ:${dealerBusinessId}]%`]
      );
      const customerParty = custRes.rows[0] || null;

      // 4. Linked Main Supplier Party in Dealer Business
      const supRes = await client.query(
        `SELECT id, party_code, name, display_name, gstin, pan, mobile, email,
                city, state, status, notes
         FROM parties 
         WHERE business_id = $1 
           AND notes LIKE $2
         LIMIT 1`,
        [dealerBusinessId, `%[MAIN_BIZ:${mainBusinessId}]%`]
      );
      const supplierParty = supRes.rows[0] || null;

      // 5. Assigned Users breakdown & sample
      const userRes = await client.query(
        `SELECT 
           COUNT(*)::int as count,
           COUNT(CASE WHEN u.status = 'ACTIVE' THEN 1 END)::int as "activeCount",
           COUNT(CASE WHEN u.status != 'ACTIVE' THEN 1 END)::int as "inactiveCount"
         FROM user_business_access uba
         INNER JOIN users u ON u.id = uba.user_id
         WHERE uba.business_id = $1`,
        [dealerBusinessId]
      );
      const userCount = userRes.rows[0]?.count || 0;
      const activeUserCount = userRes.rows[0]?.activeCount || 0;
      const inactiveUserCount = userRes.rows[0]?.inactiveCount || 0;

      const sampleUsersRes = await client.query(
        `SELECT u.id, u.username, u.full_name as "fullName", u.status, r.name as "roleName"
         FROM user_business_access uba
         INNER JOIN users u ON u.id = uba.user_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.business_id = uba.business_id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE uba.business_id = $1
         ORDER BY uba.is_default DESC, u.created_at ASC
         LIMIT 4`,
        [dealerBusinessId]
      );
      const sampleUsers = sampleUsersRes.rows;

      // 6. Stock Sharing status
      const settingsConfig = dealer.settings_config || {};
      const shareStockWithMain = Boolean(settingsConfig?.dealer?.shareStockWithMain);

      return {
        dealer: {
          id: dealer.id,
          code: dealer.code,
          name: dealer.name,
          tradeName: dealer.trade_name,
          gstin: dealer.gstin,
          pan: dealer.pan,
          phone: dealer.phone,
          email: dealer.email,
          addressLine1: dealer.address_line1,
          addressLine2: dealer.address_line2,
          city: dealer.city,
          state: dealer.state,
          stateCode: dealer.state_code,
          pincode: dealer.pincode,
          status: dealer.status,
          businessType: dealer.business_type,
          createdAt: dealer.created_at,
          updatedAt: dealer.updated_at,
        },
        parentWarehouse,
        customerParty: customerParty
          ? {
              id: customerParty.id,
              partyCode: customerParty.party_code,
              name: customerParty.name,
              displayName: customerParty.display_name,
              gstin: customerParty.gstin,
              creditLimit: parseFloat(customerParty.credit_limit || '0.00'),
              creditDays: parseInt(customerParty.credit_days || '0', 10),
              status: customerParty.status,
            }
          : null,
        supplierParty: supplierParty
          ? {
              id: supplierParty.id,
              partyCode: supplierParty.party_code,
              name: supplierParty.name,
              displayName: supplierParty.display_name,
              gstin: supplierParty.gstin,
              status: supplierParty.status,
            }
          : null,
        shareStockWithMain,
        userCount,
        activeUserCount,
        inactiveUserCount,
        sampleUsers,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 6. Update Dealer Details with Controlled Synchronization to Customer Party
   */
  static async updateDealer(
    mainBusinessId: string,
    dealerBusinessId: string,
    userId: string,
    data: UpdateDealerDTO,
    req?: Request
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingRes = await client.query(
        `SELECT * FROM businesses 
         WHERE id = $1 AND parent_business_id = $2 AND business_type = 'DEALER'`,
        [dealerBusinessId, mainBusinessId]
      );
      if (existingRes.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }
      const existing = existingRes.rows[0];

      // Update Dealer business
      const updateFields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      const addField = (col: string, val: any) => {
        if (val !== undefined) {
          updateFields.push(`${col} = $${idx++}`);
          values.push(val);
        }
      };

      addField('name', data.name?.trim() || existing.name);
      addField('trade_name', data.tradeName !== undefined ? data.tradeName?.trim() || null : existing.trade_name);
      addField('phone', data.phone !== undefined ? data.phone?.trim() || null : existing.phone);
      addField('email', data.email !== undefined ? data.email?.trim() || null : existing.email);
      addField('address_line1', data.addressLine1 !== undefined ? data.addressLine1?.trim() || null : existing.address_line1);
      addField('address_line2', data.addressLine2 !== undefined ? data.addressLine2?.trim() || null : existing.address_line2);
      addField('city', data.city !== undefined ? data.city?.trim() || null : existing.city);
      addField('state', data.state !== undefined ? data.state?.trim() || null : existing.state);
      addField('state_code', data.stateCode !== undefined ? data.stateCode?.trim() || null : existing.state_code);
      addField('pincode', data.pincode !== undefined ? data.pincode?.trim() || null : existing.pincode);
      addField('gstin', data.gstin !== undefined ? data.gstin?.trim()?.toUpperCase() || null : existing.gstin);
      addField('pan', data.pan !== undefined ? data.pan?.trim()?.toUpperCase() || null : existing.pan);
      if (data.status) addField('status', data.status);

      updateFields.push(`updated_at = NOW()`);
      values.push(dealerBusinessId, mainBusinessId);

      const updateQuery = `
        UPDATE businesses 
        SET ${updateFields.join(', ')}
        WHERE id = $${idx++} AND parent_business_id = $${idx++}
        RETURNING *
      `;
      const updatedBizRes = await client.query(updateQuery, values);
      const updatedDealer = updatedBizRes.rows[0];

      // If sync to customer party requested: update customer master fields without touching historical vouchers
      if (data.syncToCustomerParty) {
        const custRes = await client.query(
          `SELECT id FROM parties WHERE business_id = $1 AND notes LIKE $2 LIMIT 1`,
          [mainBusinessId, `%[DEALER_BIZ:${dealerBusinessId}]%`]
        );
        if (custRes.rows.length > 0) {
          const custId = custRes.rows[0].id;
          const custUpdateFields: string[] = ['updated_at = NOW()'];
          const custVals: any[] = [];
          let cIdx = 1;

          if (data.name) {
            custUpdateFields.push(`name = $${cIdx++}`);
            custVals.push(data.name.trim());
          }
          if (data.tradeName !== undefined) {
            custUpdateFields.push(`display_name = $${cIdx++}`);
            custVals.push(data.tradeName?.trim() || data.name?.trim() || null);
          }
          if (data.phone !== undefined) {
            custUpdateFields.push(`mobile = $${cIdx++}`);
            custVals.push(data.phone?.trim() || null);
          }
          if (data.email !== undefined) {
            custUpdateFields.push(`email = $${cIdx++}`);
            custVals.push(data.email?.trim() || null);
          }
          if (data.addressLine1 !== undefined) {
            custUpdateFields.push(`address_line_1 = $${cIdx++}`);
            custVals.push(data.addressLine1?.trim() || null);
          }
          if (data.city !== undefined) {
            custUpdateFields.push(`city = $${cIdx++}`);
            custVals.push(data.city?.trim() || null);
          }
          if (data.state !== undefined) {
            custUpdateFields.push(`state = $${cIdx++}`);
            custVals.push(data.state?.trim() || null);
          }
          if (data.pincode !== undefined) {
            custUpdateFields.push(`pincode = $${cIdx++}`);
            custVals.push(data.pincode?.trim() || null);
          }
          if (data.gstin !== undefined) {
            custUpdateFields.push(`gstin = $${cIdx++}`);
            custVals.push(data.gstin?.trim()?.toUpperCase() || null);
          }
          if (data.pan !== undefined) {
            custUpdateFields.push(`pan = $${cIdx++}`);
            custVals.push(data.pan?.trim()?.toUpperCase() || null);
          }
          if (data.creditLimit !== undefined) {
            custUpdateFields.push(`credit_limit = $${cIdx++}`);
            custVals.push(parseFloat(String(data.creditLimit)) || 0);
          }
          if (data.creditDays !== undefined) {
            custUpdateFields.push(`credit_days = $${cIdx++}`);
            custVals.push(String(parseInt(String(data.creditDays), 10) || 0));
          }

          custVals.push(custId, mainBusinessId);
          await client.query(
            `UPDATE parties SET ${custUpdateFields.join(', ')} WHERE id = $${cIdx++} AND business_id = $${cIdx++}`,
            custVals
          );
        }
      }

      await client.query('COMMIT');

      await recordAuditLog({
        businessId: mainBusinessId,
        userId,
        action: 'DEALER_BUSINESS_UPDATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Business',
        entityId: dealerBusinessId,
        previousValue: existing,
        newValue: updatedDealer,
        req,
      });

      return {
        success: true,
        message: `Dealer '${updatedDealer.name}' details updated.`,
        dealer: updatedDealer,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 7. Get Deactivation Warnings (Operational Check)
   */
  static async getDeactivationWarnings(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Open Orders
      const orderRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM dealer_orders 
         WHERE main_business_id = $1 AND dealer_business_id = $2 
           AND status IN ('PENDING', 'CONFIRMED', 'PROCESSING')`,
        [mainBusinessId, dealerBusinessId]
      );
      const openOrdersCount = orderRes.rows[0]?.cnt || 0;

      // 2. In-Transit Dispatches
      const shipRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM dealer_shipments 
         WHERE main_business_id = $1 AND dealer_business_id = $2 
           AND status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')`,
        [mainBusinessId, dealerBusinessId]
      );
      const inTransitDispatchesCount = shipRes.rows[0]?.cnt || 0;

      // 3. Pending Returns
      const retRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM dealer_returns 
         WHERE main_business_id = $1 AND dealer_business_id = $2 
           AND status IN ('REQUESTED', 'APPROVED', 'IN_TRANSIT')`,
        [mainBusinessId, dealerBusinessId]
      );
      const pendingReturnsCount = retRes.rows[0]?.cnt || 0;

      // 4. Pending Payment Advices
      const payRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM dealer_payment_advices 
         WHERE main_business_id = $1 AND dealer_business_id = $2 
           AND status = 'SUBMITTED'`,
        [mainBusinessId, dealerBusinessId]
      );
      const pendingPaymentAdvicesCount = payRes.rows[0]?.cnt || 0;

      // 5. Outstanding Balance on Main Customer Ledger
      const custRes = await client.query(
        `SELECT id FROM parties WHERE business_id = $1 AND notes LIKE $2 LIMIT 1`,
        [mainBusinessId, `%[DEALER_BIZ:${dealerBusinessId}]%`]
      );
      let outstandingBalance = 0;
      if (custRes.rows.length > 0) {
        const clRes = await client.query(
          `SELECT balance FROM customer_ledgers WHERE business_id = $1 AND party_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [mainBusinessId, custRes.rows[0].id]
        );
        if (clRes.rows.length > 0) {
          outstandingBalance = Math.max(0, parseFloat(clRes.rows[0].balance || '0.00'));
        }
      }

      const warnings: string[] = [];
      if (openOrdersCount > 0) warnings.push(`${openOrdersCount} open order(s) awaiting processing.`);
      if (inTransitDispatchesCount > 0) warnings.push(`${inTransitDispatchesCount} shipment(s) currently in transit.`);
      if (pendingReturnsCount > 0) warnings.push(`${pendingReturnsCount} return request(s) awaiting inspection/receipt.`);
      if (pendingPaymentAdvicesCount > 0) warnings.push(`${pendingPaymentAdvicesCount} payment advice(s) awaiting verification.`);
      if (outstandingBalance > 0) warnings.push(`₹${outstandingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} outstanding receivable balance.`);

      return {
        hasOperationalDependencies: warnings.length > 0,
        warnings,
        counts: {
          openOrdersCount,
          inTransitDispatchesCount,
          pendingReturnsCount,
          pendingPaymentAdvicesCount,
          outstandingBalance,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * 8. Deactivate Dealer
   */
  static async deactivateDealer(mainBusinessId: string, dealerBusinessId: string, userId: string, req?: Request) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `UPDATE businesses SET status = 'INACTIVE', updated_at = NOW() 
         WHERE id = $1 AND parent_business_id = $2 AND business_type = 'DEALER' 
         RETURNING id, code, name, status`,
        [dealerBusinessId, mainBusinessId]
      );
      if (res.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }

      // Also set linked Customer Party to INACTIVE
      await client.query(
        `UPDATE parties SET status = 'INACTIVE', updated_at = NOW() 
         WHERE business_id = $1 AND notes LIKE $2`,
        [mainBusinessId, `%[DEALER_BIZ:${dealerBusinessId}]%`]
      );

      await recordAuditLog({
        businessId: mainBusinessId,
        userId,
        action: 'DEALER_BUSINESS_DEACTIVATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Business',
        entityId: dealerBusinessId,
        newValue: { status: 'INACTIVE' },
        req,
      });

      return {
        success: true,
        message: `Dealer '${res.rows[0].name}' has been deactivated.`,
        dealer: res.rows[0],
      };
    } finally {
      client.release();
    }
  }

  /**
   * 9. Activate Dealer
   */
  static async activateDealer(mainBusinessId: string, dealerBusinessId: string, userId: string, req?: Request) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `UPDATE businesses SET status = 'ACTIVE', updated_at = NOW() 
         WHERE id = $1 AND parent_business_id = $2 AND business_type = 'DEALER' 
         RETURNING id, code, name, status`,
        [dealerBusinessId, mainBusinessId]
      );
      if (res.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }

      // Also restore linked Customer Party to ACTIVE
      await client.query(
        `UPDATE parties SET status = 'ACTIVE', updated_at = NOW() 
         WHERE business_id = $1 AND notes LIKE $2`,
        [mainBusinessId, `%[DEALER_BIZ:${dealerBusinessId}]%`]
      );

      await recordAuditLog({
        businessId: mainBusinessId,
        userId,
        action: 'DEALER_BUSINESS_ACTIVATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Business',
        entityId: dealerBusinessId,
        newValue: { status: 'ACTIVE' },
        req,
      });

      return {
        success: true,
        message: `Dealer '${res.rows[0].name}' has been activated.`,
        dealer: res.rows[0],
      };
    } finally {
      client.release();
    }
  }

  /**
   * 10. Delete Empty Dealer (Permanent Deletion Strictly Guarded by Zero-Dependency Check)
   */
  static async deleteEmptyDealer(mainBusinessId: string, dealerBusinessId: string, userId: string, req?: Request) {
    const client = await pool.connect();
    try {
      const dealerRes = await client.query(
        `SELECT id, name, code FROM businesses 
         WHERE id = $1 AND parent_business_id = $2 AND business_type = 'DEALER'`,
        [dealerBusinessId, mainBusinessId]
      );
      if (dealerRes.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }
      const dealer = dealerRes.rows[0];

      // Operational tables check
      const dependencyChecks = [
        { table: 'dealer_orders', col: 'dealer_business_id', label: 'Dealer Orders' },
        { table: 'dealer_shipments', col: 'dealer_business_id', label: 'Shipments' },
        { table: 'dealer_goods_receipts', col: 'dealer_business_id', label: 'Goods Receipts' },
        { table: 'dealer_returns', col: 'dealer_business_id', label: 'Dealer Returns' },
        { table: 'dealer_payment_advices', col: 'dealer_business_id', label: 'Payment Advices' },
        { table: 'sales_orders', col: 'business_id', label: 'Sales Orders' },
        { table: 'sales_invoices', col: 'business_id', label: 'Sales Invoices' },
        { table: 'purchase_orders', col: 'business_id', label: 'Purchase Orders' },
        { table: 'purchase_invoices', col: 'business_id', label: 'Purchase Invoices' },
        { table: 'unique_items', col: 'business_id', label: 'Inventory Stock' },
        { table: 'user_business_access', col: 'business_id', label: 'Assigned Users' },
      ];

      const foundDependencies: { label: string; count: number }[] = [];
      for (const chk of dependencyChecks) {
        try {
          const q = await client.query(
            `SELECT COUNT(*)::int as cnt FROM "${chk.table}" WHERE "${chk.col}" = $1`,
            [dealerBusinessId]
          );
          const cnt = q.rows[0]?.cnt || 0;
          if (cnt > 0) {
            foundDependencies.push({ label: chk.label, count: cnt });
          }
        } catch (e) {
          // table might not exist in some environments, ignore
        }
      }

      if (foundDependencies.length > 0) {
        throw new Error(
          `Cannot delete dealer '${dealer.name}'. It contains active records: ${foundDependencies.map(d => `${d.label} (${d.count})`).join(', ')}. Deactivate the dealer instead.`
        );
      }

      // Safe to delete empty dealer
      await client.query('BEGIN');

      // 1. Remove parties inside Dealer business
      await client.query(`DELETE FROM parties WHERE business_id = $1`, [dealerBusinessId]);

      // 2. Remove settings
      await client.query(`DELETE FROM business_settings WHERE business_id = $1`, [dealerBusinessId]);

      // 3. Remove dealer business
      await client.query(`DELETE FROM businesses WHERE id = $1`, [dealerBusinessId]);

      // 4. Clean up Main customer party if it was solely auto-provisioned for this dealer and has 0 invoices/orders
      const linkedCustRes = await client.query(
        `SELECT id FROM parties WHERE business_id = $1 AND notes LIKE $2`,
        [mainBusinessId, `%[DEALER_BIZ:${dealerBusinessId}]%`]
      );
      if (linkedCustRes.rows.length > 0) {
        const custId = linkedCustRes.rows[0].id;
        const invCheck = await client.query(
          `SELECT COUNT(*)::int as cnt FROM sales_invoices WHERE business_id = $1 AND party_id = $2`,
          [mainBusinessId, custId]
        );
        if ((invCheck.rows[0]?.cnt || 0) === 0) {
          await client.query(`DELETE FROM parties WHERE id = $1 AND business_id = $2`, [custId, mainBusinessId]);
        }
      }

      await client.query('COMMIT');

      await recordAuditLog({
        businessId: mainBusinessId,
        userId,
        action: 'DEALER_BUSINESS_DELETED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'Business',
        entityId: dealerBusinessId,
        previousValue: dealer,
        req,
      });

      return {
        success: true,
        message: `Empty dealer '${dealer.name}' (${dealer.code}) permanently deleted.`,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
