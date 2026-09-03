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
 * Validates whether a given string is a syntactically valid PostgreSQL connection string or URL.
 */
export function isValidPostgresConnectionString(str: string | null | undefined): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  if (trimmed.length < 10) return false;
  
  // Exclude common dummy placeholders
  if (/^[0-9]+$/.test(trimmed) || trimmed === 'placeholder' || trimmed === 'undefined' || trimmed === 'null') {
    return false;
  }

  if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) {
    try {
      const url = new URL(trimmed);
      return Boolean(url.hostname && url.hostname.length > 0);
    } catch {
      return false;
    }
  }

  // Support libpq key-value format (e.g. "host=localhost dbname=optic")
  if (trimmed.includes('host=') && (trimmed.includes('dbname=') || trimmed.includes('user='))) {
    return true;
  }

  return false;
}

/**
 * Resolves the canonical PostgreSQL connection string for the application.
 * 
 * Uses Neon PostgreSQL as the primary database source of truth.
 * Prioritizes DATABASE_URL and DATABASE_URL_UNPOOLED.
 */
export function resolveDatabaseConfig(): DbConfigResolution {
  const envKeys = Object.keys(process.env);

  const candidateNames = [
    'DATABASE_URL',
    'database_url',
    'DATABASE_URL_UNPOOLED',
    'database_url_unpooled',
    'NEON_DATABASE_URL',
    'neon_database_url',
    'PG_URL',
    'POSTGRES_URL',
    'PGDATABASE_URL',
    'DEV_DATABASE_URL',
    'LOCAL_DATABASE_URL',
  ];

  const allCheckedVariables: CheckedEnvVar[] = candidateNames.map((name) => {
    const val = process.env[name];
    return {
      name,
      isSet: !!val && val.trim().length > 0,
      length: val ? val.trim().length : 0,
    };
  });

  // 1. Primary check: DATABASE_URL, DATABASE_URL_UNPOOLED, NEON_DATABASE_URL
  for (const name of candidateNames) {
    const val = process.env[name];
    if (val && isValidPostgresConnectionString(val)) {
      return {
        connectionString: val.trim(),
        detectedVariable: name,
        allCheckedVariables,
      };
    }
  }

  // 2. Netlify SDK getConnectionString() fallback if available
  if (process.env.NETLIFY) {
    try {
      const netlifyUrl = getConnectionString();
      if (netlifyUrl && isValidPostgresConnectionString(netlifyUrl)) {
        return {
          connectionString: netlifyUrl.trim(),
          detectedVariable: '@netlify/database getConnectionString()',
          allCheckedVariables,
        };
      }
    } catch {
      // Ignored
    }
  }

  // 3. Fallback scan for any variable key matching case-insensitively
  for (const name of ['database_url', 'database_url_unpooled', 'neon_database_url', 'postgres_url']) {
    const match = envKeys.find((k) => k.toLowerCase() === name);
    if (match && process.env[match] && isValidPostgresConnectionString(process.env[match])) {
      const val = process.env[match]!.trim();
      return {
        connectionString: val,
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
  const p = new Pool({
    connectionString: conn,
    ssl: isSslRequired(conn) ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Attach error handler to prevent unhandled errors on idle clients from terminating the process
  p.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client pool:', err?.message || err);
  });

  return p;
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
  host?: string | null;
  code?: string | null;
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
        provider: 'Neon PostgreSQL',
        error: 'PostgreSQL connection string unavailable. No valid DATABASE_URL or DATABASE_URL_UNPOOLED detected in environment variables.',
        tip: 'In Settings > Environment Variables, provide DATABASE_URL with your Neon PostgreSQL connection string (e.g. postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require), then click "Retry Connection".',
        host: safeInfo.dbHost,
      };
    }

    const result = await pool.query('SELECT version()');
    console.log(`[SERVER DB DIAGNOSTIC] Result: SUCCESS (Connected)`);
    console.log(`PostgreSQL Engine:     ${result.rows[0]?.version || 'PostgreSQL'}`);
    console.log('------------------------------------');

    const isNeon = (safeInfo.dbHost || '').includes('neon.tech');
    const isLocalhost = safeInfo.dbHost === 'localhost' || safeInfo.dbHost === '127.0.0.1';
    const providerName = isNeon 
      ? 'Neon PostgreSQL' 
      : (isLocalhost ? 'PostgreSQL (Local)' : 'PostgreSQL');

    return {
      connected: true,
      provider: providerName,
      version: result.rows[0]?.version,
      host: safeInfo.dbHost,
    };
  } catch (err: any) {
    const errCode = err?.code || null;
    const errMsg = err?.message || String(err);
    const isEndpointDisabled = errMsg.includes('endpoint has been disabled') || errCode === '28000';

    console.error('[SERVER DB DIAGNOSTIC] Result: FAILED (Connection Error)');
    console.error(`PostgreSQL Error Code: ${errCode || 'NO_CODE'}`);
    console.error(`Error Message:         ${errMsg}`);
    if (err?.detail) console.error(`Error Detail:          ${err.detail}`);
    if (err?.routine) console.error(`Error Routine:         ${err.routine}`);
    console.log('------------------------------------');

    let tip = 'Verify that the database password and host are correct, and SSL is enabled (sslmode=require) for Neon PostgreSQL.';
    let formattedError = errMsg;

    if (isEndpointDisabled) {
      formattedError = 'The Neon database compute endpoint has been disabled or suspended.';
      tip = 'Check your Neon console or provide an active PostgreSQL connection string in DATABASE_URL, then click "Retry Connection".';
    } else if (errCode === 'EAI_AGAIN' || errMsg.includes('getaddrinfo') || errMsg.includes('ENOTFOUND')) {
      formattedError = `Database host could not be resolved (${safeInfo.dbHost || 'invalid host'}). Please check the connection URL.`;
      tip = 'Check your connection string hostname or provide an active Neon PostgreSQL URL in DATABASE_URL.';
    } else if (errCode === 'ECONNREFUSED') {
      formattedError = `Connection refused at ${safeInfo.dbHost || 'localhost'}:${safeInfo.dbPort || '5432'}. Database server is offline or unreachable.`;
      tip = 'Ensure the target PostgreSQL instance is running and accepting connections.';
    }

    const isNeon = (safeInfo.dbHost || '').includes('neon.tech');
    const isLocalhost = safeInfo.dbHost === 'localhost' || safeInfo.dbHost === '127.0.0.1';
    const providerName = isNeon 
      ? 'Neon PostgreSQL' 
      : (isLocalhost ? 'PostgreSQL (Local)' : 'PostgreSQL');

    return {
      connected: false,
      provider: providerName,
      error: formattedError,
      tip,
      host: safeInfo.dbHost,
      code: errCode,
    };
  }
}

