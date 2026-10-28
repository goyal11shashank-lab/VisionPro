import { db, pool } from '../db/index.js';
import { parties, businesses } from '../db/schema.js';
import { eq, and, or, ilike, desc, count, sql } from 'drizzle-orm';
import { AuditService } from './auditService.js';

export interface CreatePartyDTO {
  partyCode?: string;
  name: string;
  displayName?: string;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  mobile?: string;
  alternateMobile?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  gstin?: string;
  pan?: string;
  creditLimit?: number | string;
  creditDays?: string | number;
  status?: 'ACTIVE' | 'INACTIVE';
  whatsappOptIn?: boolean;
  notes?: string;
}

export interface UpdatePartyDTO {
  name?: string;
  displayName?: string;
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  mobile?: string;
  alternateMobile?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  gstin?: string;
  pan?: string;
  creditLimit?: number | string;
  creditDays?: string | number;
  status?: 'ACTIVE' | 'INACTIVE';
  whatsappOptIn?: boolean;
  notes?: string;
}

export class PartyService {
  /**
   * Generates a unique, business-scoped party code (e.g. SUP-00001, CUST-00001, PRT-00001)
   */
  static async generatePartyCode(
    businessId: string,
    partyType: 'CUSTOMER' | 'SUPPLIER' | 'BOTH' = 'SUPPLIER'
  ): Promise<string> {
    const prefix = partyType === 'SUPPLIER' ? 'SUP' : (partyType === 'CUSTOMER' ? 'CUST' : 'PRT');
    const searchPattern = `${prefix}-%`;

    const res = await pool.query(
      `SELECT party_code FROM parties 
       WHERE business_id = $1 AND party_code LIKE $2 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [businessId, searchPattern]
    );

    let maxNum = 0;
    for (const row of res.rows) {
      const codeStr = row.party_code || '';
      const parts = codeStr.split('-');
      if (parts.length >= 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    const nextSeq = maxNum + 1;
    const padded = String(nextSeq).padStart(5, '0');
    return `${prefix}-${padded}`;
  }

  /**
   * Creates a new Party under the authenticated business
   */
  static async createParty(
    businessId: string,
    data: CreatePartyDTO,
    userId?: string
  ) {
    if (!businessId) {
      throw new Error('Business ID is strictly required for party creation');
    }

    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Party name is mandatory');
    }

    const validTypes = ['CUSTOMER', 'SUPPLIER', 'BOTH'];
    if (!data.partyType || !validTypes.includes(data.partyType)) {
      throw new Error(`Invalid party type: ${data.partyType}. Must be CUSTOMER, SUPPLIER, or BOTH`);
    }

    // Auto-generate code if missing
    let partyCode = data.partyCode?.trim();
    if (!partyCode) {
      partyCode = await this.generatePartyCode(businessId, data.partyType);
    }

    // Check for duplicate party code inside this business
    const existing = await db
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.partyCode, partyCode)))
      .limit(1);

    if (existing.length > 0) {
      // If code collided, generate a fresh next sequence
      partyCode = await this.generatePartyCode(businessId, data.partyType);
    }

    const [newParty] = await db
      .insert(parties)
      .values({
        businessId,
        partyCode,
        name: data.name.trim(),
        displayName: data.displayName?.trim() || data.name.trim(),
        partyType: data.partyType,
        mobile: data.mobile?.trim() || null,
        alternateMobile: data.alternateMobile?.trim() || null,
        email: data.email?.trim() || null,
        addressLine1: data.addressLine1?.trim() || null,
        addressLine2: data.addressLine2?.trim() || null,
        city: data.city?.trim() || null,
        state: data.state?.trim() || null,
        pincode: data.pincode?.trim() || null,
        country: data.country?.trim() || 'India',
        gstin: data.gstin?.trim()?.toUpperCase() || null,
        pan: data.pan?.trim()?.toUpperCase() || null,
        creditLimit: String(data.creditLimit || '0.00'),
        creditDays: String(data.creditDays || '0'),
        status: data.status || 'ACTIVE',
        whatsappOptIn: data.whatsappOptIn !== undefined ? data.whatsappOptIn : true,
        notes: data.notes?.trim() || null,
        createdBy: userId || null,
        updatedBy: userId || null,
      })
      .returning();

    // Record audit trail
    await AuditService.log({
      businessId,
      userId,
      module: 'parties',
      action: 'create',
      entityType: 'party',
      entityId: newParty.id,
      newValue: {
        id: newParty.id,
        partyCode: newParty.partyCode,
        name: newParty.name,
        partyType: newParty.partyType,
      },
    });

    return newParty;
  }

  /**
   * Retrieves parties filtered by type, status, or search term
   */
  static async getParties(
    businessId: string,
    filters: {
      partyType?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 200);
    const offset = filters.offset || 0;

    let conditions = [eq(parties.businessId, businessId)];

    if (filters.status) {
      conditions.push(eq(parties.status, filters.status));
    }

    if (filters.partyType) {
      if (filters.partyType === 'SUPPLIER') {
        // Includes BOTH as suppliers
        conditions.push(or(eq(parties.partyType, 'SUPPLIER'), eq(parties.partyType, 'BOTH'))!);
      } else if (filters.partyType === 'CUSTOMER') {
        // Includes BOTH as customers
        conditions.push(or(eq(parties.partyType, 'CUSTOMER'), eq(parties.partyType, 'BOTH'))!);
      } else {
        conditions.push(eq(parties.partyType, filters.partyType));
      }
    }

    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(parties.name, term),
          ilike(parties.displayName, term),
          ilike(parties.partyCode, term),
          ilike(parties.mobile, term),
          ilike(parties.gstin, term),
          ilike(parties.city, term)
        )!
      );
    }

    const rows = await db
      .select()
      .from(parties)
      .where(and(...conditions))
      .orderBy(desc(parties.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalCount] = await db
      .select({ count: count() })
      .from(parties)
      .where(and(...conditions));

    const enrichedParties = await this.enrichPartiesWithLedgerBalances(businessId, rows, filters.partyType);

    return {
      parties: enrichedParties,
      total: totalCount.count,
      limit,
      offset,
    };
  }

  /**
   * Helper to enrich party rows with live ledger balances (customer & supplier ledgers)
   */
  public static async enrichPartiesWithLedgerBalances(
    businessId: string,
    partyRows: any[],
    requestedPartyType?: string
  ) {
    if (!partyRows || partyRows.length === 0) return [];

    const partyIds = partyRows.map(p => p.id);

    // 1. Fetch latest customer ledger balances
    const custLedgerRes = await pool.query(
      `SELECT DISTINCT ON (party_id) party_id, balance, transaction_date
       FROM customer_ledgers
       WHERE business_id = $1 AND party_id = ANY($2::uuid[])
       ORDER BY party_id, transaction_date DESC, created_at DESC, id DESC`,
      [businessId, partyIds]
    );
    const custLedgerMap = new Map<string, number>();
    for (const r of custLedgerRes.rows) {
      custLedgerMap.set(r.party_id, parseFloat(r.balance) || 0);
    }

    // 2. Fetch latest supplier ledger balances
    const suppLedgerRes = await pool.query(
      `SELECT DISTINCT ON (party_id) party_id, balance, transaction_date
       FROM supplier_ledgers
       WHERE business_id = $1 AND party_id = ANY($2::uuid[])
       ORDER BY party_id, transaction_date DESC, created_at DESC, id DESC`,
      [businessId, partyIds]
    );
    const suppLedgerMap = new Map<string, number>();
    for (const r of suppLedgerRes.rows) {
      suppLedgerMap.set(r.party_id, parseFloat(r.balance) || 0);
    }

    // 3. Fallback for parties without customer_ledgers row
    const missingCustIds = partyIds.filter(id => !custLedgerMap.has(id));
    if (missingCustIds.length > 0) {
      const fallbackCustRes = await pool.query(
        `SELECT 
           si.party_id,
           COALESCE(SUM(si.grand_total), 0) - COALESCE(SUM(pa.allocated), 0) - COALESCE(SUM(sr.returned), 0) as net_outstanding
         FROM sales_invoices si
         LEFT JOIN (
           SELECT document_id, SUM(allocated_amount) as allocated
           FROM payment_allocations
           WHERE business_id = $1 AND status = 'ACTIVE'
           GROUP BY document_id
         ) pa ON pa.document_id = si.id
         LEFT JOIN (
           SELECT sales_invoice_id, SUM(grand_total) as returned
           FROM sales_returns
           WHERE business_id = $1 AND status = 'POSTED'
           GROUP BY sales_invoice_id
         ) sr ON sr.sales_invoice_id = si.id
         WHERE si.business_id = $1 AND si.party_id = ANY($2::uuid[]) AND si.status = 'POSTED'
         GROUP BY si.party_id`,
        [businessId, missingCustIds]
      );
      for (const r of fallbackCustRes.rows) {
        const net = parseFloat(r.net_outstanding) || 0;
        if (net !== 0) {
          custLedgerMap.set(r.party_id, net);
        }
      }

      // Check unallocated advance receipts
      const unallocRes = await pool.query(
        `SELECT party_id, COALESCE(SUM(unallocated_amount), 0) as unalloc
         FROM payments
         WHERE business_id = $1 AND party_id = ANY($2::uuid[]) AND status = 'POSTED' AND payment_type = 'RECEIPT'
         GROUP BY party_id`,
        [businessId, missingCustIds]
      );
      for (const r of unallocRes.rows) {
        const unalloc = parseFloat(r.unalloc) || 0;
        if (unalloc > 0) {
          const cur = custLedgerMap.get(r.party_id) || 0;
          custLedgerMap.set(r.party_id, cur - unalloc);
        }
      }
    }

    // 4. Fallback for suppliers without supplier_ledgers row
    const missingSuppIds = partyIds.filter(id => !suppLedgerMap.has(id));
    if (missingSuppIds.length > 0) {
      const fallbackSuppRes = await pool.query(
        `SELECT 
           pi.supplier_party_id as party_id,
           COALESCE(SUM(pi.grand_total), 0) - COALESCE(SUM(pa.allocated), 0) - COALESCE(SUM(pr.returned), 0) as net_outstanding
         FROM purchase_invoices pi
         LEFT JOIN (
           SELECT document_id, SUM(allocated_amount) as allocated
           FROM payment_allocations
           WHERE business_id = $1 AND status = 'ACTIVE'
           GROUP BY document_id
         ) pa ON pa.document_id = pi.id
         LEFT JOIN (
           SELECT purchase_invoice_id, SUM(grand_total) as returned
           FROM purchase_returns
           WHERE business_id = $1 AND status = 'POSTED'
           GROUP BY purchase_invoice_id
         ) pr ON pr.purchase_invoice_id = pi.id
         WHERE pi.business_id = $1 AND pi.supplier_party_id = ANY($2::uuid[]) AND pi.status = 'POSTED'
         GROUP BY pi.supplier_party_id`,
        [businessId, missingSuppIds]
      );
      for (const r of fallbackSuppRes.rows) {
        const net = parseFloat(r.net_outstanding) || 0;
        if (net !== 0) {
          suppLedgerMap.set(r.party_id, net);
        }
      }
    }

    // 5. Enrich rows
    return partyRows.map(p => {
      const custBal = custLedgerMap.get(p.id) || 0;
      const suppBal = suppLedgerMap.get(p.id) || 0;

      let effectiveBalance = 0;
      let effectiveDrCr = 'Dr';

      if (requestedPartyType === 'CUSTOMER') {
        effectiveBalance = custBal;
        effectiveDrCr = custBal >= 0 ? 'Dr' : 'Cr';
      } else if (requestedPartyType === 'SUPPLIER') {
        effectiveBalance = suppBal;
        effectiveDrCr = suppBal >= 0 ? 'Cr' : 'Dr';
      } else if (p.partyType === 'SUPPLIER') {
        effectiveBalance = suppBal;
        effectiveDrCr = suppBal >= 0 ? 'Cr' : 'Dr';
      } else {
        effectiveBalance = custBal !== 0 ? custBal : suppBal;
        effectiveDrCr = custBal !== 0 ? (custBal >= 0 ? 'Dr' : 'Cr') : (suppBal >= 0 ? 'Cr' : 'Dr');
      }

      return {
        ...p,
        balance: effectiveBalance,
        currentBalance: effectiveBalance,
        customerBalance: custBal,
        supplierBalance: suppBal,
        balanceDrCr: effectiveDrCr,
        balanceFormatted: effectiveBalance !== 0
          ? `₹${Math.abs(effectiveBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${effectiveDrCr}`
          : '₹0.00',
      };
    });
  }

  /**
   * Retrieves single party by ID strictly scoped to businessId
   */
  static async getPartyById(businessId: string, partyId: string) {
    const [party] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.id, partyId)))
      .limit(1);

    if (!party) {
      throw new Error(`Party not found with ID ${partyId}`);
    }

    const [enriched] = await this.enrichPartiesWithLedgerBalances(businessId, [party]);
    return enriched || party;
  }

  /**
   * Updates party details
   */
  static async updateParty(
    businessId: string,
    partyId: string,
    data: UpdatePartyDTO,
    userId?: string
  ) {
    const existing = await this.getPartyById(businessId, partyId);

    const [updated] = await db
      .update(parties)
      .set({
        name: data.name !== undefined ? data.name.trim() : existing.name,
        displayName: data.displayName !== undefined ? data.displayName.trim() : existing.displayName,
        partyType: data.partyType !== undefined ? data.partyType : existing.partyType,
        mobile: data.mobile !== undefined ? data.mobile.trim() : existing.mobile,
        alternateMobile: data.alternateMobile !== undefined ? data.alternateMobile.trim() : existing.alternateMobile,
        email: data.email !== undefined ? data.email.trim() : existing.email,
        addressLine1: data.addressLine1 !== undefined ? data.addressLine1.trim() : existing.addressLine1,
        addressLine2: data.addressLine2 !== undefined ? data.addressLine2.trim() : existing.addressLine2,
        city: data.city !== undefined ? data.city.trim() : existing.city,
        state: data.state !== undefined ? data.state.trim() : existing.state,
        pincode: data.pincode !== undefined ? data.pincode.trim() : existing.pincode,
        country: data.country !== undefined ? data.country.trim() : existing.country,
        gstin: data.gstin !== undefined ? data.gstin.trim()?.toUpperCase() : existing.gstin,
        pan: data.pan !== undefined ? data.pan.trim()?.toUpperCase() : existing.pan,
        creditLimit: data.creditLimit !== undefined ? String(data.creditLimit) : existing.creditLimit,
        creditDays: data.creditDays !== undefined ? String(data.creditDays) : existing.creditDays,
        status: data.status !== undefined ? data.status : existing.status,
        whatsappOptIn: data.whatsappOptIn !== undefined ? data.whatsappOptIn : existing.whatsappOptIn,
        notes: data.notes !== undefined ? data.notes.trim() : existing.notes,
        updatedAt: new Date(),
        updatedBy: userId || null,
      })
      .where(and(eq(parties.businessId, businessId), eq(parties.id, partyId)))
      .returning();

    await AuditService.log({
      businessId,
      userId,
      module: 'parties',
      action: 'edit',
      entityType: 'party',
      entityId: partyId,
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  /**
   * Check references and safely delete a party
   */
  static async deleteParty(businessId: string, partyId: string, userId?: string) {
    const existing = await this.getPartyById(businessId, partyId);

    const checkRes = await pool.query(
      `SELECT 
        (SELECT COUNT(*)::int FROM sales_invoices WHERE party_id = $1) AS sales_invoices_count,
        (SELECT COUNT(*)::int FROM sales_orders WHERE party_id = $1) AS sales_orders_count,
        (SELECT COUNT(*)::int FROM sales_returns WHERE party_id = $1) AS sales_returns_count,
        (SELECT COUNT(*)::int FROM purchase_invoices WHERE supplier_party_id = $1) AS purchase_invoices_count,
        (SELECT COUNT(*)::int FROM purchase_returns WHERE supplier_party_id = $1) AS purchase_returns_count,
        (SELECT COUNT(*)::int FROM customer_ledgers WHERE party_id = $1) AS customer_ledgers_count,
        (SELECT COUNT(*)::int FROM supplier_ledgers WHERE party_id = $1) AS supplier_ledgers_count,
        (SELECT COUNT(*)::int FROM payments WHERE party_id = $1) AS payments_count,
        (SELECT COUNT(*)::int FROM payment_allocations WHERE party_id = $1) AS payment_allocations_count`,
      [partyId]
    );

    const counts = checkRes.rows[0] || {};
    const refDetails: string[] = [];
    if (counts.sales_invoices_count > 0) refDetails.push(`${counts.sales_invoices_count} sales invoices`);
    if (counts.sales_orders_count > 0) refDetails.push(`${counts.sales_orders_count} sales orders`);
    if (counts.sales_returns_count > 0) refDetails.push(`${counts.sales_returns_count} sales returns`);
    if (counts.purchase_invoices_count > 0) refDetails.push(`${counts.purchase_invoices_count} purchase bills`);
    if (counts.purchase_returns_count > 0) refDetails.push(`${counts.purchase_returns_count} purchase returns`);
    if (counts.customer_ledgers_count > 0) refDetails.push(`${counts.customer_ledgers_count} customer ledger entries`);
    if (counts.supplier_ledgers_count > 0) refDetails.push(`${counts.supplier_ledgers_count} supplier ledger entries`);
    if (counts.payments_count > 0) refDetails.push(`${counts.payments_count} payment vouchers`);
    if (counts.payment_allocations_count > 0) refDetails.push(`${counts.payment_allocations_count} payment allocations`);

    if (refDetails.length > 0) {
      throw new Error(
        `Cannot delete party "${existing.name}" (${existing.partyCode}) because they are referenced in ${refDetails.join(', ')}. To deactivate this party instead, set their status to INACTIVE.`
      );
    }

    await pool.query('DELETE FROM party_item_prices WHERE party_id = $1', [partyId]);
    await pool.query('DELETE FROM parties WHERE id = $1 AND business_id = $2', [partyId, businessId]);

    await AuditService.log({
      businessId,
      userId,
      module: 'parties',
      action: 'delete',
      entityType: 'party',
      entityId: partyId,
      previousValue: existing,
    });

    return {
      success: true,
      message: `Party "${existing.name}" (${existing.partyCode}) was permanently deleted.`,
    };
  }

  /**
   * Bulk deletes parties with safety checks
   */
  static async bulkDeleteParties(businessId: string, partyIds: string[], userId?: string) {
    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      throw new Error('Please provide an array of party IDs to delete.');
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of partyIds) {
      try {
        await this.deleteParty(businessId, id, userId);
        deletedCount++;
      } catch (err: any) {
        errors.push(err.message || `Failed to delete party ID ${id}`);
      }
    }

    return {
      success: deletedCount > 0,
      deletedCount,
      errors,
      message:
        deletedCount === partyIds.length
          ? `Successfully deleted all ${deletedCount} selected parties.`
          : `Deleted ${deletedCount} of ${partyIds.length} parties. ${errors.length} could not be deleted due to dependencies.`,
    };
  }
}
