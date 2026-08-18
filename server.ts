import path from 'path';
import { fileURLToPath } from 'url';
import { createExpressApp } from './server/app.js';
import { checkDatabaseConnection } from './server/db/index.js';
import { seedInitialDatabase } from './server/db/seed.js';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createExpressApp();
  const PORT = 3000;

  // Check database and seed on startup if PostgreSQL is reachable
  const dbHealth = await checkDatabaseConnection();
  if (dbHealth.connected) {
    console.log('[Database] PostgreSQL connected successfully:', dbHealth.version);
    try {
      await seedInitialDatabase();
      console.log('[Database] Schema bootstrap and initial seeding verified.');
    } catch (e: any) {
      console.warn('[Database] Initial auto-seed warning (may already be initialized):', e.message);
    }
  } else {
    console.warn('[Database Notice] PostgreSQL is currently offline or DATABASE_URL not yet connected. Error:', dbHealth.error);
    console.warn('[Database Notice] Configure DATABASE_URL in environment or settings to connect to Netlify Database / PostgreSQL.');
  }

  // Vite middleware for development vs static dist serving in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Optical ERP] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Startup Error]', err);
});
