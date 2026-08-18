import { Router, Request, Response } from 'express';
import { checkDatabaseConnection, pool } from '../db/index.js';

const router = Router();

/**
 * GET /api/health
 * Production health and database status inspection
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const dbStatus = await checkDatabaseConnection();
  
  let tableCount = 0;
  let tables: string[] = [];

  if (dbStatus.connected) {
    try {
      const resTables = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name ASC
      `);
      tables = resTables.rows.map(r => r.table_name);
      tableCount = tables.length;
    } catch (e) {
      // Ignored if query fails
    }
  }

  res.json({
    status: dbStatus.connected ? 'healthy' : 'degraded',
    service: 'Optical ERP Billing & Accounting API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: {
      provider: 'PostgreSQL',
      connected: dbStatus.connected,
      version: dbStatus.version,
      error: dbStatus.error,
      tablesCount: tableCount,
      tables,
    },
    deployment: {
      platform: process.env.NETLIFY ? 'Netlify Functions' : 'Container Server (Vite + Express)',
      nodeEnv: process.env.NODE_ENV || 'development',
    },
  });
});

export default router;
