import path from 'path';
import { createExpressApp } from './server/app.js';
import { checkDatabaseConnection } from './server/db/index.js';
import { seedInitialDatabase } from './server/db/seed.js';
import { WhatsAppConnectionManager } from './server/services/whatsapp/whatsappConnectionManager.js';
import express from 'express';
import dotenv from 'dotenv';
import { runOptionalStartupActions } from './server/startupPolicy.js';

dotenv.config();


async function startServer() {
  const app = createExpressApp();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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

  // Listen on port 3000 immediately so dev server is responsive right away
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Optical ERP] Server running at http://0.0.0.0:${PORT}`);

    // Verify connectivity without writing. Mutating startup actions require explicit opt-in.
    checkDatabaseConnection()
      .then(async (dbHealth) => {
        if (dbHealth.connected) {
          console.log('[Database] PostgreSQL connected successfully:', dbHealth.version);
          await runOptionalStartupActions(process.env, {
            initializeDatabase: async () => {
              await seedInitialDatabase();
              console.log('[Database] Authorized schema bootstrap and seeding completed.');
            },
            restoreWhatsAppSessions: async () => {
              await WhatsAppConnectionManager.restoreAllSessions();
            },
            log: console.log,
          });
        } else {
          console.warn('[Database Notice] PostgreSQL is currently offline or DATABASE_URL not yet connected. Error:', dbHealth.error);
          console.warn('[Database Notice] Configure DATABASE_URL in environment or settings to connect to Netlify Database / PostgreSQL.');
        }
      })
      .catch((err) => {
        console.error('[Database Startup Check Error]', err);
      });
  });

  // Graceful shutdown
  const handleShutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal}. Shutting down cleanly...`);
    try {
      await WhatsAppConnectionManager.shutdown();
    } catch {}
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[Server Startup Error]', err);
});
