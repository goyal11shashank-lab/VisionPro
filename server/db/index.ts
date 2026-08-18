import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getConnectionString } from '@netlify/database';
import * as schema from './schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export interface CheckedEnvVar {
  name: string;
  isSet: boolean;
  length: number;
}

export interface DbConfigResolution {
  connectionString: string | null;
  detectedVariable: string | null;
  allCheckedVariables: CheckedEnvVar[];
}

/**
 * Resolves the canonical PostgreSQL connection string for the application.
 * 
 * IMPORTANT:
 * - Always uses the READ & WRITE connection URL for production transactions (INSERT, UPDATE, DELETE).
 * - Read-only branch URLs must not be used for transactional operations.
 * - Prioritizes Netlify Database credentials:
 *   1. Netlify Database SDK getConnectionString()
 *   2. process.env.NETLIFY_DB_URL / process.env.netlify_db_url (automatically provided by Netlify Database)
 *   3. process.env.NETLIFY_DATABASE_URL / process.env.netlify_database_url (alias provided in Netlify environments)
 *   4. process.env.DATABASE_URL / process.env.database_url (standard PostgreSQL fallback)
 * - The connection URL remains strictly server-side and is never exposed to the client.
 */
export function resolveDatabaseConfig(): DbConfigResolution {
  const envKeys = Object.keys(process.env);
  const candidateNames = [
    'NETLIFY_DB_URL',
    'netlify_db_url',
    'NETLIFY_DATABASE_URL',
    'netlify_database_url',
    'DATABASE_URL',
    'database_url',
    'PG_URL',
    'POSTGRES_URL',
    'PGDATABASE_URL',
  ];

  const allCheckedVariables: CheckedEnvVar[] = candidateNames.map((name) => {
    const val = process.env[name];
    return {
      name,
      isSet: !!val && val.trim().length > 0,
      length: val ? val.trim().length : 0,
    };
  });

  // 1. Check Netlify Database official SDK
  try {
    const netlifyUrl = getConnectionString();
    if (netlifyUrl && typeof netlifyUrl === 'string' && netlifyUrl.trim().length > 0) {
      return {
        connectionString: netlifyUrl.trim(),
        detectedVariable: '@netlify/database getConnectionString()',
        allCheckedVariables,
      };
    }
  } catch {
    // getConnectionString throws if NETLIFY_DB_URL is not set in environment
  }

  // 2. Check direct environment variables
  for (const name of candidateNames) {
    const directVal = process.env[name];
    if (directVal && directVal.trim().length > 0) {
      return {
        connectionString: directVal.trim(),
        detectedVariable: name,
        allCheckedVariables,
      };
    }
  }

  // 3. Fallback scan for any variable key matching case-insensitively
  for (const name of ['netlify_db_url', 'netlify_database_url', 'database_url']) {
    const match = envKeys.find((k) => k.toLowerCase() === name);
    if (match && process.env[match] && process.env[match]!.trim().length > 0) {
      return {
        connectionString: process.env[match]!.trim(),
        detectedVariable: match,
        allCheckedVariables,
      };
    }
  }

  return {
    connectionString: null,
    detectedVariable: null,
    allCheckedVariables,
  };
}

export function resolveDatabaseConnectionString(): string | null {
  return resolveDatabaseConfig().connectionString;
}

/**
 * Extracts non-sensitive host and database name information for server-side diagnostic logs.
 * NEVER extracts or returns passwords or tokens.
 */
function extractSafeDbInfo(connStr: string | null): {
  dbHost: string | null;
  dbPort: string | null;
  dbName: string | null;
  sslMode: string | null;
} {
  if (!connStr) {
    return { dbHost: null, dbPort: null, dbName: null, sslMode: null };
  }
  try {
    const parsed = new URL(connStr);
    return {
      dbHost: parsed.hostname || null,
      dbPort: parsed.port || '5432',
      dbName: parsed.pathname ? parsed.pathname.replace(/^\//, '') : null,
      sslMode: parsed.searchParams.get('sslmode') || null,
    };
  } catch {
    const hostMatch = connStr.match(/@([^:/]+)(?::(\d+))?\/([^?]+)/);
    return {
      dbHost: hostMatch?.[1] || null,
      dbPort: hostMatch?.[2] || '5432',
      dbName: hostMatch?.[3] || null,
      sslMode: connStr.includes('sslmode=') ? connStr.split('sslmode=')[1]?.split('&')[0] : null,
    };
  }
}

/**
 * Checks if the PostgreSQL connection requires SSL.
 * Netlify Database, Neon, Supabase, and AWS RDS require SSL connections.
 */
function isSslRequired(conn: string | null): boolean {
  if (!conn) return false;
  if (conn.includes('localhost') || conn.includes('127.0.0.1')) {
    return false;
  }
  return true; // Default to SSL enabled for remote cloud databases
}

/**
 * Creates or retrieves the pg Pool instance dynamically.
 * In serverless environments, this ensures the pool always picks up the active environment variables.
 */
function createPool(): pg.Pool {
  const conn = resolveDatabaseConnectionString() || 'postgresql://postgres:postgres@localhost:5432/optical_erp';
  return new Pool({
    connectionString: conn,
    ssl: isSslRequired(conn) ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

// Configure PostgreSQL connection pool with standard SSL & connection timeouts
export const pool = createPool();

export const db = drizzle(pool, { schema });

/**
 * Helper to check live database connectivity safely without exposing secrets.
 * Outputs sanitized diagnostic telemetry to server logs only.
 */
export async function checkDatabaseConnection(): Promise<{
  connected: boolean;
  version?: string;
  error?: string;
  provider: string;
  tip?: string;
}> {
  const config = resolveDatabaseConfig();
  const safeInfo = extractSafeDbInfo(config.connectionString);
  const sslReq = isSslRequired(config.connectionString);

  // Server-side diagnostic report header (Sanitized - NO PASSWORDS / SECRETS)
  console.log('--- [SERVER DB DIAGNOSTIC CHECK] ---');
  console.log(`Timestamp:             ${new Date().toISOString()}`);
  console.log(`Detected Variable:     ${config.detectedVariable || 'NONE (No env var found)'}`);
  console.log(`Connection Str Exists: ${config.connectionString ? `YES (Length: ${config.connectionString.length} chars)` : 'NO (null/empty)'}`);
  console.log(`Database Host:         ${safeInfo.dbHost || 'N/A'}`);
  console.log(`Database Port:         ${safeInfo.dbPort || 'N/A'}`);
  console.log(`Database Name:         ${safeInfo.dbName || 'N/A'}`);
  console.log(`SSL Active:            ${sslReq ? 'YES ({ rejectUnauthorized: false })' : 'NO'}`);
  console.log(`SSL Mode Query:        ${safeInfo.sslMode || 'N/A'}`);
  console.log(
    `Checked Vars:          ${
      config.allCheckedVariables
        .filter((v) => v.isSet)
        .map((v) => `${v.name}(set:${v.length}chars)`)
        .join(', ') || 'ALL CANDIDATES UNSET'
    }`
  );

  try {
    if (!config.connectionString) {
      console.warn('[SERVER DB DIAGNOSTIC] Result: FAILED (No connection string detected in environment)');
      console.log('------------------------------------');
      return {
        connected: false,
        provider: 'Netlify Database (PostgreSQL)',
        error: 'Database connection unavailable. In Netlify Site Settings > Environment Variables, add NETLIFY_DB_URL with the Netlify Database Read & Write connection string.',
        tip: 'Ensure NETLIFY_DB_URL or DATABASE_URL is set in your Netlify site environment variables and redeploy.',
      };
    }

    const result = await pool.query('SELECT version()');
    console.log(`[SERVER DB DIAGNOSTIC] Result: SUCCESS (Connected)`);
    console.log(`PostgreSQL Engine:     ${result.rows[0]?.version || 'PostgreSQL'}`);
    console.log('------------------------------------');

    return {
      connected: true,
      provider: config.connectionString.includes('neon') || config.connectionString.includes('netlify') ? 'Netlify Database' : 'PostgreSQL',
      version: result.rows[0]?.version,
    };
  } catch (err: any) {
    console.error('[SERVER DB DIAGNOSTIC] Result: FAILED (Connection Error)');
    console.error(`PostgreSQL Error Code: ${err?.code || 'NO_CODE'}`);
    console.error(`Error Message:         ${err?.message || err}`);
    if (err?.detail) console.error(`Error Detail:          ${err.detail}`);
    if (err?.routine) console.error(`Error Routine:         ${err.routine}`);
    console.log('------------------------------------');

    return {
      connected: false,
      provider: 'Netlify Database (PostgreSQL)',
      error: err?.message || 'Database connection unavailable. Please check the server configuration.',
      tip: 'Verify that the database password and host are correct, and SSL is enabled (sslmode=require).',
    };
  }
}

