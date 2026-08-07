'use strict';

// The family lives in Ohio; keep "today" and "this month" in their clock,
// not the deploy region's UTC. Override with TZ_NAME if you ever move.
process.env.TZ_NAME = process.env.TZ_NAME || process.env.TZ || 'America/New_York';

const path = require('path');
const express = require('express');
const { open, DEFAULT_DB_PATH } = require('./src/db');
const { createApi } = require('./src/api');
const { startScheduler } = require('./src/push');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
const PUBLIC_DIR = path.join(__dirname, 'public');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  // 2mb so a pasted bank statement fits; everything else stays tiny.
  app.use(express.json({ limit: '2mb' }));

  const api = createApi(db);
  app.use('/api', api.router);

  // db and pinSet let a deploy be verified from outside: the database path in
  // use (should be on the volume) and whether FAMILY_PIN is set, never its value.
  app.get('/healthz', (req, res) => res.json({
    ok: true,
    sse: api.clientCount(),
    db: DB_PATH,
    pinSet: Boolean(process.env.FAMILY_PIN),
  }));

  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      etag: true,
      setHeaders(res, filePath) {
        // Everything except icons revalidates on every load ("no-cache"
        // still allows 304s, so repeat loads stay fast). A deploy must
        // never leave a phone pinned to an old build — the service worker
        // provides the offline copy, not the HTTP cache.
        if (filePath.includes(`${path.sep}icons${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // Single-page app: anything else that is not /api falls back to the shell.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return app;
}

function start() {
  const db = open(DB_PATH);
  const app = createApp(db);
  startScheduler(db); // daily bill reminders + month-report pushes
  const server = app.listen(PORT, () => {
    console.log(`Lattimer Family Budget listening on :${PORT}`);
    console.log(`  database: ${DB_PATH}`);
    console.log(`  timezone: ${process.env.TZ_NAME}`);
    if (!process.env.FAMILY_PIN) {
      console.warn('  WARNING: FAMILY_PIN is not set — falling back to 0000.');
    }
  });

  const shutdown = (signal) => () => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));

  return server;
}

if (require.main === module) start();

module.exports = { createApp, start };
