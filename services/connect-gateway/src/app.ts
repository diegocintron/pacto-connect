import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { originValidation } from './middleware/origin.js';
import { adminRoutes } from './routes/admin.js';
import { sessionRoutes } from './routes/session.js';

type GatewayVariables = {
  apiKey: ApiKey;
};

export function createApp(): Hono<{ Variables: GatewayVariables }> {
  const app = new Hono<{ Variables: GatewayVariables }>();

  app.get('/health', (c) => c.json({ status: 'ok', service: 'connect-gateway' }));

  app.route('/admin', adminRoutes);

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/health' || path.startsWith('/admin')) {
      return next();
    }
    return originValidation(c, next);
  });

  app.route('/v1/session', sessionRoutes);

  app.all('*', (c) => c.json({ error: 'not found' }, 404));

  return app;
}

export const app = createApp();
