import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<{ success: boolean; message: string; tablesCount?: number }> {
  try {
    const migrationFile = path.join(__dirname, 'migrations', '0000_initial.sql');
    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found at ${migrationFile}`);
    }

    const sqlContent = fs.readFileSync(migrationFile, 'utf8');
    await pool.query(sqlContent);

    // Verify created tables
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    const tableNames = tableRes.rows.map(r => r.table_name);
    console.log(`[Migrations] Successfully verified ${tableNames.length} tables in PostgreSQL:`, tableNames.join(', '));

    return {
      success: true,
      message: `Database migrations executed successfully. ${tableNames.length} tables verified.`,
      tablesCount: tableNames.length,
    };
  } catch (error: any) {
    console.error('[Migrations Error]', error);
    return {
      success: false,
      message: error.message || 'Migration execution failed',
    };
  }
}

// Standalone execution support via `npm run db:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((res) => {
      console.log(res.message);
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
