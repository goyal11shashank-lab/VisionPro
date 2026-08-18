import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getConnectionString } from '@netlify/database';
import * as schema from './schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Resolves the canonical PostgreSQL connection string for the application.
 * 
 * IMPORTANT:
 * - Always uses the READ & WRITE connection URL for production transactions (INSERT, UPDATE, DELETE).
 * - Read-only branch URLs must not be used for transactional operations.
 * - Prioritizes Netlify Database credentials:
 *   1. Netlify Database SDK getConnectionString()
 *   2. process.env.NETLIFY_DB_URL (automatically provided by Netlify Database)
 *   3. process.env.NETLIFY_DATABASE_URL (alias provided in Netlify environments)
 *   4. process.env.DATABASE_URL (standard PostgreSQL fallback)
 * - The connection URL remains strictly server-side and is never exposed to the client.
 */
export function resolveDatabaseConnectionString(): string | null {
  // 1. Check Netlify Database official SDK
  try {
    const netlifyUrl = getConnectionString();
    if (netlifyUrl && typeof netlifyUrl === 'string' && netlifyUrl.trim().length > 0) {
      return netlifyUrl.trim();
    }
  } catch {
    // getConnectionString throws if NETLIFY_DB_URL is not set in environment
  }

  // 2. Check NETLIFY_DB_URL (Netlify Database default variable)
  if (process.env.NETLIFY_DB_URL && process.env.NETLIFY_DB_URL.trim().length > 0) {
    return process.env.NETLIFY_DB_URL.trim();
  }

  // 3. Check NETLIFY_DATABASE_URL (Netlify Database alternate alias)
  if (process.env.NETLIFY_DATABASE_URL && process.env.NETLIFY_DATABASE_URL.trim().length > 0) {
    return process.env.NETLIFY_DATABASE_URL.trim();
  }

  // 4. Check DATABASE_URL (Standard PostgreSQL fallback)
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    return process.env.DATABASE_URL.trim();
  }

  return null;
}

const connectionString = resolveDatabaseConnectionString() || 'postgresql://postgres:postgres@localhost:5432/optical_erp';

// Configure PostgreSQL connection pool with standard SSL & connection timeouts
export const pool = new Pool({
  connectionString,
  ssl: (connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') || connectionString.includes('netlify') || connectionString.includes('supabase.co'))
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

export const db = drizzle(pool, { schema });

/**
 * Helper to check live database connectivity safely without exposing secrets
 */
export async function checkDatabaseConnection(): Promise<{ connected: boolean; version?: string; error?: string; provider: string }> {
  try {
    const activeConn = resolveDatabaseConnectionString();
    if (!activeConn && !process.env.DATABASE_URL) {
      return {
        connected: false,
        provider: 'Netlify Database (PostgreSQL)',
        error: 'Database connection unavailable. Please check the server configuration.',
      };
    }

    const result = await pool.query('SELECT version()');
    return {
      connected: true,
      provider: activeConn?.includes('neon') || activeConn?.includes('netlify') ? 'Netlify Database' : 'PostgreSQL',
      version: result.rows[0]?.version,
    };
  } catch (err: any) {
    console.error('[Database Connection Error]', err?.message || err);
    return {
      connected: false,
      provider: 'Netlify Database (PostgreSQL)',
      error: 'Database connection unavailable. Please check the server configuration.',
    };
  }
}

