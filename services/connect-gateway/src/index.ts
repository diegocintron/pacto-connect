import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startDeliveryRunner } from './webhooks/runner.js';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`connect-gateway listening on http://localhost:${info.port}`);
  startDeliveryRunner();
  console.log('webhook delivery runner started');
});

export { app };
