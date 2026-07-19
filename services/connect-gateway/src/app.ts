import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { originValidation } from './middleware/origin.js';
import {
  createRateLimiter,
  getRateLimitConfig,
  rateLimitMiddleware,
} from './middleware/rate-limit.js';
import { adminRoutes } from './routes/admin.js';
import { escrowRoutes } from './routes/escrows.js';
import { inboundWebhookRoutes } from './routes/inbound-webhooks.js';
import { quoteRoutes } from './routes/quote.js';
import { sessionRoutes } from './routes/session.js';
import { testControlRoutes } from './routes/test-controls.js';

type GatewayVariables = {
  apiKey: ApiKey;
};

export function createApp(): Hono<{ Variables: GatewayVariables }> {
  const app = new Hono<{ Variables: GatewayVariables }>();
  const rateLimiter = createRateLimiter(getRateLimitConfig());

  app.get('/health', (c) => c.json({ status: 'ok', service: 'connect-gateway' }));

  app.route('/admin', adminRoutes);

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/health' ||
      path.startsWith('/admin') ||
      path.startsWith('/v1/webhooks/inbound')
    ) {
      return next();
    }
    return originValidation(c, next);
  });

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/health' ||
      path.startsWith('/admin') ||
      path.startsWith('/v1/webhooks/inbound') ||
      c.req.method === 'OPTIONS'
    ) {
      return next();
    }
    return rateLimitMiddleware(rateLimiter, (ctx) => ctx.get('apiKey')?.id)(c, next);
  });

  app.route('/v1/session', sessionRoutes);
  app.route('/v1/escrows', escrowRoutes);
  app.route('/v1/test', testControlRoutes);
  app.route('/v1/quote', quoteRoutes);
  app.route('/v1/webhooks/inbound', inboundWebhookRoutes);

  app.all('*', (c) => c.json({ error: 'not found' }, 404));

  return app;
}

export const app = createApp();
