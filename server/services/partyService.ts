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

    return {
      parties: rows,
      total: totalCount.count,
      limit,
      offset,
    };
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

    return party;
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
}
