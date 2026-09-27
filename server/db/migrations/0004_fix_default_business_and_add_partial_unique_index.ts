import { pool } from '../index.js';

export async function runMigration0004() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('[Migration 0004] Repairing duplicate default businesses and adding partial unique index...');

    // 1. Ensure any duplicate default access records are repaired:
    // Keep earliest created default per user, set subsequent ones to false
    await client.query(`
      WITH ranked_defaults AS (
        SELECT id, user_id,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) as rn
        FROM user_business_access
        WHERE is_default = true
      )
      UPDATE user_business_access
      SET is_default = false
      WHERE id IN (
        SELECT id FROM ranked_defaults WHERE rn > 1
      );
    `);

    // 2. Add partial unique index to enforce at most one default business per user
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_biz_access_user_default_unique_idx"
      ON "user_business_access" ("user_id")
      WHERE "is_default" = true;
    `);

    await client.query('COMMIT');
    console.log('[Migration 0004] Successfully completed default business repair and partial unique index.');
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[Migration 0004 Error]', error);
    throw error;
  } finally {
    client.release();
  }
}
