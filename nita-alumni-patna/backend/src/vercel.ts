// Entry point for Vercel. Vercel runs the app as a serverless function: each instance handles
// requests for a while and is then discarded, so the app is built once per instance and the
// database pool is kept small. Tables are created during the build (see "vercel-build").
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';

let ready: ReturnType<typeof start> | undefined;

async function start() {
  const config = loadConfig();
  const { db } = createDb(config.DATABASE_URL, { max: 3 });
  const app = await buildApp(db, { adminKey: config.ADMIN_API_KEY, trustProxy: true, fastify: { logger: { level: 'info' } } });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= start();
  let app;
  try {
    app = await ready;
  } catch (err) {
    ready = undefined; // try again on the next request, e.g. after fixing an environment variable
    console.error(err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'STARTUP', message: 'The server is not configured correctly. An admin should check the Vercel logs.' }));
    return;
  }
  app.server.emit('request', req, res);
}
