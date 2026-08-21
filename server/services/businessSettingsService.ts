import { pool, db } from '../db/index.js';
import { businessSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface BusinessSettingsData {
  lowStockThreshold: number;
  config: Record<string, any>;
}

export class BusinessSettingsService {
  /**
   * Fetch settings for a business, returning defaults if not yet created.
   */
  static async getSettings(businessId: string): Promise<BusinessSettingsData> {
    try {
      const [existing] = await db
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, businessId))
        .limit(1);

      if (existing) {
        return {
          lowStockThreshold: parseFloat(existing.lowStockThreshold || '1.00'),
          config: (existing.config as Record<string, any>) || {},
        };
      }

      // Default threshold: 1.00 pair
      return {
        lowStockThreshold: 1.00,
        config: {},
      };
    } catch {
      // Fallback safe defaults
      return {
        lowStockThreshold: 1.00,
        config: {},
      };
    }
  }

  /**
   * Update or insert business settings
   */
  static async updateSettings(
    businessId: string,
    data: { lowStockThreshold?: number; config?: Record<string, any> }
  ): Promise<BusinessSettingsData> {
    const threshold = data.lowStockThreshold !== undefined ? Math.max(0, data.lowStockThreshold) : 1.00;
    const configData = data.config || {};

    await pool.query(
      `INSERT INTO business_settings (business_id, low_stock_threshold, config, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (business_id)
       DO UPDATE SET 
         low_stock_threshold = EXCLUDED.low_stock_threshold,
         config = COALESCE(business_settings.config, '{}'::jsonb) || EXCLUDED.config,
         updated_at = NOW()`,
      [businessId, threshold.toFixed(2), JSON.stringify(configData)]
    );

    return {
      lowStockThreshold: threshold,
      config: configData,
    };
  }
}
