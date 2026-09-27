import { pool, db } from '../db/index.js';
import { businesses, businessSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { recordAuditLog } from './auditService.js';
import { AuthenticatedUser } from '../middleware/auth.js';
import { BusinessSettingsService } from './businessSettingsService.js';
import { Request } from 'express';

export interface DealerOnboardingStatus {
  isDealer: boolean;
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingCompletedBy: string | null;
  canConfigure: boolean;
  dealer: {
    id: string;
    code: string;
    name: string;
    tradeName: string | null;
    gstin: string | null;
    pan: string | null;
    phone: string | null;
    email: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    pincode: string | null;
  };
  mainWarehouse: {
    id: string;
    name: string;
    tradeName: string | null;
    dealerCode: string;
    creditLimit: number;
    creditDays: number;
    connected: boolean;
  };
  preferences: {
    shareStockWithMain: boolean;
    defaultUnit: string;
    defaultGstRate: number;
  };
}

export interface UpdateBusinessDetailsInput {
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
}

export class DealerOnboardingService {
  /**
   * Evaluates whether the user has permission to configure the Dealer
   */
  static canUserConfigureDealer(user: AuthenticatedUser): boolean {
    if (user.isSuperAdmin) return true;
    const perms = user.permissions || [];
    if (perms.includes('admin:manage_settings') || perms.includes('business:edit') || perms.includes('admin:manage_roles')) {
      return true;
    }
    const roles = user.roles || [];
    return roles.some(r => r.code === 'MANAGER' || r.code === 'ADMIN' || r.code === 'SUPER_ADMIN');
  }

  /**
   * Safely retrieve onboarding status and master details for current dealer business
   */
  static async getOnboardingStatus(
    dealerBusinessId: string,
    user: AuthenticatedUser
  ): Promise<DealerOnboardingStatus> {
    const client = await pool.connect();
    try {
      const bizRes = await client.query(
        `SELECT b.id, b.code, b.name, b.trade_name, b.gstin, b.pan, b.phone, b.email,
                b.address_line1, b.address_line2, b.city, b.state, b.state_code, b.pincode,
                b.business_type, b.parent_business_id, b.settings_config,
                bs.config as bs_config
         FROM businesses b
         LEFT JOIN business_settings bs ON bs.business_id = b.id
         WHERE b.id = $1`,
        [dealerBusinessId]
      );

      if (bizRes.rows.length === 0) {
        throw new Error('Business not found');
      }

      const row = bizRes.rows[0];
      const isDealer = row.business_type === 'DEALER';

      if (!isDealer) {
        return {
          isDealer: false,
          onboardingCompleted: true,
          onboardingCompletedAt: null,
          onboardingCompletedBy: null,
          canConfigure: false,
          dealer: {
            id: row.id,
            code: row.code || '',
            name: row.name,
            tradeName: row.trade_name,
            gstin: row.gstin,
            pan: row.pan,
            phone: row.phone,
            email: row.email,
            addressLine1: row.address_line1,
            addressLine2: row.address_line2,
            city: row.city,
            state: row.state,
            stateCode: row.state_code,
            pincode: row.pincode,
          },
          mainWarehouse: {
            id: '',
            name: '',
            tradeName: null,
            dealerCode: '',
            creditLimit: 0,
            creditDays: 0,
            connected: false,
          },
          preferences: {
            shareStockWithMain: false,
            defaultUnit: 'PRS',
            defaultGstRate: 5,
          },
        };
      }

      const bConfig = row.settings_config || {};
      const bsConfig = row.bs_config || {};

      const onboardingCompleted = Boolean(
        bConfig?.dealer?.onboardingCompleted ?? bsConfig?.dealer?.onboardingCompleted ?? false
      );
      const onboardingCompletedAt =
        bConfig?.dealer?.onboardingCompletedAt || bsConfig?.dealer?.onboardingCompletedAt || null;
      const onboardingCompletedBy =
        bConfig?.dealer?.onboardingCompletedBy || bsConfig?.dealer?.onboardingCompletedBy || null;

      const shareStockWithMain = Boolean(
        bConfig?.dealer?.shareStockWithMain ??
        bConfig?.settings?.dealer?.shareStockWithMain ??
        bsConfig?.dealer?.shareStockWithMain ??
        bsConfig?.settings?.dealer?.shareStockWithMain ??
        false
      );

      // Connected Main Warehouse relationship
      let mainWarehouse = {
        id: row.parent_business_id || '',
        name: 'Main Optical Warehouse',
        tradeName: null as string | null,
        dealerCode: row.code || '',
        creditLimit: 0,
        creditDays: 0,
        connected: false,
      };

      if (row.parent_business_id) {
        const parentRes = await client.query(
          `SELECT id, code, name, trade_name FROM businesses WHERE id = $1`,
          [row.parent_business_id]
        );
        if (parentRes.rows.length > 0) {
          mainWarehouse.name = parentRes.rows[0].name;
          mainWarehouse.tradeName = parentRes.rows[0].trade_name;
          mainWarehouse.connected = true;

          // Fetch credit limit and credit days from customer party in Main Warehouse
          const partyRes = await client.query(
            `SELECT credit_limit, credit_days 
             FROM parties 
             WHERE business_id = $1 AND party_type IN ('CUSTOMER', 'BOTH')
               AND (notes LIKE $2 OR LOWER(name) = LOWER($3) OR ($4 <> '' AND gstin IS NOT NULL AND UPPER(gstin) = UPPER($4)))
             ORDER BY created_at DESC LIMIT 1`,
            [
              row.parent_business_id,
              `%[DEALER_BIZ:${dealerBusinessId}]%`,
              row.name,
              row.gstin || '',
            ]
          );

          if (partyRes.rows.length > 0) {
            mainWarehouse.creditLimit = parseFloat(partyRes.rows[0].credit_limit || '0.00');
            mainWarehouse.creditDays = parseInt(partyRes.rows[0].credit_days || '0', 10);
          }
        }
      }

      const canConfigure = this.canUserConfigureDealer(user);

      return {
        isDealer: true,
        onboardingCompleted,
        onboardingCompletedAt,
        onboardingCompletedBy,
        canConfigure,
        dealer: {
          id: row.id,
          code: row.code || '',
          name: row.name,
          tradeName: row.trade_name,
          gstin: row.gstin,
          pan: row.pan,
          phone: row.phone,
          email: row.email,
          addressLine1: row.address_line1,
          addressLine2: row.address_line2,
          city: row.city,
          state: row.state,
          stateCode: row.state_code,
          pincode: row.pincode,
        },
        mainWarehouse,
        preferences: {
          shareStockWithMain,
          defaultUnit: 'PRS',
          defaultGstRate: 5,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Log onboarding start
   */
  static async startOnboarding(
    dealerBusinessId: string,
    user: AuthenticatedUser,
    req?: Request
  ): Promise<{ success: boolean }> {
    const status = await this.getOnboardingStatus(dealerBusinessId, user);
    if (!status.isDealer) return { success: true };

    if (!status.onboardingCompleted) {
      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: user.id,
        action: 'DEALER_ONBOARDING_STARTED',
        module: 'DEALER_ONBOARDING',
        entityType: 'Business',
        entityId: dealerBusinessId,
        newValue: {
          startedBy: user.username,
          startedAt: new Date().toISOString(),
        },
        req,
      });
    }
    return { success: true };
  }

  /**
   * Update Business details in Step 2 with validation
   */
  static async updateBusinessDetails(
    dealerBusinessId: string,
    user: AuthenticatedUser,
    data: UpdateBusinessDetailsInput,
    req?: Request
  ): Promise<{ success: boolean; message: string; business: any }> {
    if (!this.canUserConfigureDealer(user)) {
      throw new Error('You do not have permission to update dealer business configuration.');
    }

    const client = await pool.connect();
    try {
      const currRes = await client.query(
        `SELECT id, name, trade_name, gstin, pan, phone, email, address_line1, address_line2, city, state, state_code, pincode, business_type
         FROM businesses WHERE id = $1`,
        [dealerBusinessId]
      );
      if (currRes.rows.length === 0) {
        throw new Error('Dealer business not found.');
      }
      const current = currRes.rows[0];
      if (current.business_type !== 'DEALER') {
        throw new Error('Cannot update non-dealer business via dealer onboarding.');
      }

      // Mandatory fields verification
      const newName = data.name !== undefined ? data.name.trim() : current.name;
      const newState = data.state !== undefined ? data.state.trim() : current.state;
      const newStateCode = data.stateCode !== undefined ? data.stateCode.trim() : current.state_code;

      if (!newName) {
        throw new Error('Business Name is required.');
      }
      if (!newState) {
        throw new Error('State is required for GST compliance.');
      }
      if (!newStateCode) {
        throw new Error('State Code is required for GST compliance.');
      }

      // Format and clean fields
      const newTradeName = data.tradeName !== undefined ? data.tradeName.trim() : current.trade_name;
      const newPhone = data.phone !== undefined ? data.phone.trim() : current.phone;
      const newEmail = data.email !== undefined ? data.email.trim().toLowerCase() : current.email;
      const newAddress1 = data.addressLine1 !== undefined ? data.addressLine1.trim() : current.address_line1;
      const newAddress2 = data.addressLine2 !== undefined ? data.addressLine2.trim() : current.address_line2;
      const newCity = data.city !== undefined ? data.city.trim() : current.city;
      const newPincode = data.pincode !== undefined ? data.pincode.trim() : current.pincode;
      const newGstin = data.gstin !== undefined ? (data.gstin ? data.gstin.trim().toUpperCase() : null) : current.gstin;
      const newPan = data.pan !== undefined ? (data.pan ? data.pan.trim().toUpperCase() : null) : current.pan;

      // GSTIN format check if provided
      if (newGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(newGstin)) {
        throw new Error('Invalid GSTIN format. Expected 15-character alphanumeric GSTIN.');
      }

      await client.query(
        `UPDATE businesses
         SET name = $1, trade_name = $2, phone = $3, email = $4,
             address_line1 = $5, address_line2 = $6, city = $7, state = $8,
             state_code = $9, pincode = $10, gstin = $11, pan = $12, updated_at = NOW()
         WHERE id = $13`,
        [
          newName,
          newTradeName || null,
          newPhone || null,
          newEmail || null,
          newAddress1 || null,
          newAddress2 || null,
          newCity || null,
          newState,
          newStateCode,
          newPincode || null,
          newGstin || null,
          newPan || null,
          dealerBusinessId,
        ]
      );

      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: user.id,
        action: 'DEALER_BUSINESS_UPDATED',
        module: 'DEALER_ONBOARDING',
        entityType: 'Business',
        entityId: dealerBusinessId,
        previousValue: current,
        newValue: {
          name: newName,
          tradeName: newTradeName,
          phone: newPhone,
          email: newEmail,
          city: newCity,
          state: newState,
          stateCode: newStateCode,
          pincode: newPincode,
          gstin: newGstin,
          pan: newPan,
        },
        req,
      });

      return {
        success: true,
        message: 'Dealer business details updated successfully.',
        business: {
          id: dealerBusinessId,
          name: newName,
          tradeName: newTradeName,
          phone: newPhone,
          email: newEmail,
          addressLine1: newAddress1,
          addressLine2: newAddress2,
          city: newCity,
          state: newState,
          stateCode: newStateCode,
          pincode: newPincode,
          gstin: newGstin,
          pan: newPan,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update Inventory Preferences (minimal: share stock availability with main warehouse)
   */
  static async updatePreferences(
    dealerBusinessId: string,
    user: AuthenticatedUser,
    preferences: { shareStockWithMain?: boolean; defaultUnit?: string; defaultGstRate?: number },
    req?: Request
  ): Promise<{ success: boolean; preferences: any }> {
    if (!this.canUserConfigureDealer(user)) {
      throw new Error('You do not have permission to update dealer preferences.');
    }

    const client = await pool.connect();
    try {
      const shareVal = preferences.shareStockWithMain === true;

      // Update business_settings via BusinessSettingsService
      const current = await BusinessSettingsService.getSettings(dealerBusinessId);
      const updatedSettings = {
        ...current.settings,
        dealer: {
          ...(current.settings.dealer || {}),
          shareStockWithMain: shareVal,
        },
      };

      await BusinessSettingsService.updateSettings(
        dealerBusinessId,
        { settings: updatedSettings },
        user.id,
        req
      );

      // Also safely merge into businesses.settings_config
      const bizRes = await client.query(`SELECT settings_config FROM businesses WHERE id = $1`, [dealerBusinessId]);
      const currentBizConfig = bizRes.rows[0]?.settings_config || {};
      const newBizConfig = {
        ...currentBizConfig,
        dealer: {
          ...(currentBizConfig.dealer || {}),
          shareStockWithMain: shareVal,
        },
      };

      await client.query(
        `UPDATE businesses SET settings_config = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(newBizConfig), dealerBusinessId]
      );

      return {
        success: true,
        preferences: {
          shareStockWithMain: shareVal,
          defaultUnit: preferences.defaultUnit || 'PRS',
          defaultGstRate: preferences.defaultGstRate || 5,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Complete Dealer Onboarding
   * Idempotent: safe against double-click
   */
  static async completeOnboarding(
    dealerBusinessId: string,
    user: AuthenticatedUser,
    req?: Request
  ): Promise<{ success: boolean; message: string; alreadyCompleted?: boolean }> {
    if (!this.canUserConfigureDealer(user)) {
      throw new Error('You do not have permission to complete dealer onboarding.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const bizRes = await client.query(
        `SELECT id, name, state, state_code, business_type, settings_config
         FROM businesses
         WHERE id = $1 FOR UPDATE`,
        [dealerBusinessId]
      );

      if (bizRes.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('Dealer business not found.');
      }

      const biz = bizRes.rows[0];
      if (biz.business_type !== 'DEALER') {
        await client.query('ROLLBACK');
        throw new Error('Only DEALER businesses can complete dealer onboarding.');
      }

      // Validate essential master data required by invoice/tax engine
      if (!biz.name || !biz.state || !biz.state_code) {
        await client.query('ROLLBACK');
        throw new Error('Cannot complete setup: Business Name, State, and State Code are mandatory.');
      }

      const existingConfig = biz.settings_config || {};
      if (existingConfig?.dealer?.onboardingCompleted === true) {
        await client.query('COMMIT');
        return {
          success: true,
          message: 'Dealer onboarding has already been completed.',
          alreadyCompleted: true,
        };
      }

      const nowIso = new Date().toISOString();

      // Merge safely into businesses.settings_config
      const updatedBizConfig = {
        ...existingConfig,
        dealer: {
          ...(existingConfig.dealer || {}),
          onboardingCompleted: true,
          onboardingCompletedAt: nowIso,
          onboardingCompletedBy: user.id,
        },
      };

      await client.query(
        `UPDATE businesses SET settings_config = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updatedBizConfig), dealerBusinessId]
      );

      // Merge safely into business_settings.config
      const bsRes = await client.query(
        `SELECT config FROM business_settings WHERE business_id = $1`,
        [dealerBusinessId]
      );
      const existingBsConfig = bsRes.rows[0]?.config || {};
      const updatedBsConfig = {
        ...existingBsConfig,
        dealer: {
          ...(existingBsConfig.dealer || {}),
          onboardingCompleted: true,
          onboardingCompletedAt: nowIso,
          onboardingCompletedBy: user.id,
        },
      };

      await client.query(
        `INSERT INTO business_settings (business_id, config, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (business_id)
         DO UPDATE SET config = $2, updated_at = NOW()`,
        [dealerBusinessId, JSON.stringify(updatedBsConfig)]
      );

      await client.query('COMMIT');

      // Audit Log
      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: user.id,
        action: 'DEALER_ONBOARDING_COMPLETED',
        module: 'DEALER_ONBOARDING',
        entityType: 'Business',
        entityId: dealerBusinessId,
        newValue: {
          onboardingCompleted: true,
          completedAt: nowIso,
          completedByUserId: user.id,
          completedByUsername: user.username,
        },
        req,
      });

      return {
        success: true,
        message: 'Dealer onboarding completed successfully.',
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
