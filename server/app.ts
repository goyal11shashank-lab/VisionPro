import express, { Request, Response, NextFunction } from 'express';
import authRoutes from './routes/auth.js';
import businessRoutes from './routes/businesses.js';
import userRoutes from './routes/users.js';
import roleRoutes from './routes/roles.js';
import auditRoutes from './routes/audit.js';
import dashboardRoutes from './routes/dashboard.js';
import healthRoutes from './routes/health.js';

export function createExpressApp() {
  const app = express();

  // Core middlewares
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Basic CORS headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Business-Id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Mount API routers
  app.use('/api/auth', authRoutes);
  app.use('/api/businesses', businessRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/roles', roleRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/health', healthRoutes);

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[API Unhandled Error]', err);
    res.status(err.status || 500).json({
      error: 'SERVER_ERROR',
      message: err.message || 'Internal server error occurred',
    });
  });

  return app;
}
