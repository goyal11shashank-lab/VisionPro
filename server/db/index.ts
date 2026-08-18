import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/optical_erp';

// Configure PostgreSQL connection pool with standard SSL & connection timeouts
export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') || connectionString.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });

// Helper to check live database connectivity
export async function checkDatabaseConnection(): Promise<{ connected: boolean; version?: string; error?: string }> {
  try {
    const result = await pool.query('SELECT version()');
    return {
      connected: true,
      version: result.rows[0]?.version,
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err.message || 'Unable to establish connection to PostgreSQL',
    };
  }
}
