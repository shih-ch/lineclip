import 'dotenv/config';
import Fastify from 'fastify';
import { webhookHandler } from './webhook/handler';

const app = Fastify({ logger: true });

// Preserve raw body for LINE signature validation
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body as string));
    } catch (err: any) {
      done(err, undefined);
    }
  },
);

app.post('/webhook', webhookHandler);

app.get('/health', async () => ({ status: 'ok' }));

const port = parseInt(process.env.PORT || '3000', 10);
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`SaveBot running on port ${port}`);
});
