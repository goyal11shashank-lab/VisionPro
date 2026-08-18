import serverless from 'serverless-http';
import { createExpressApp } from '../../server/app.js';

const app = createExpressApp();

// Netlify Serverless Function Handler
export const handler = serverless(app);
