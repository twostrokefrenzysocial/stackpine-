import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { getSettings } from './db.js';
import { seed } from './seed.js';
import { requireAuth } from './auth.js';
import { STANDARDS } from './standards.js';
import { configurePush } from './services/notifications.js';
import { startScheduler } from './services/scheduler.js';

import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import logRoutes from './routes/logs.js';
import workoutRoutes from './routes/workouts.js';
import testRoutes from './routes/tests.js';
import progressRoutes from './routes/progress.js';
import todayRoutes from './routes/today.js';
import mealRoutes from './routes/meals.js';
import pushRoutes from './routes/push.js';

seed({ quiet: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl, health checks, native clients
      if (origins.includes('*') || origins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed.`));
    },
  })
);

// Unauthenticated on purpose: platform health checks hit this. The commit is
// reported so you can tell which build is actually running without needing a
// platform API token. Railway sets RAILWAY_GIT_COMMIT_SHA on every deploy.
app.get('/health', (req, res) => {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null;
  res.json({
    ok: true,
    service: 'academy-ready',
    commit: commit ? commit.slice(0, 7) : null,
    time: new Date().toISOString(),
  });
});

app.get('/api/standards', (req, res) => {
  res.json(STANDARDS);
});

app.use('/api/auth', authRoutes);

app.use('/api/today', requireAuth, todayRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/logs', requireAuth, logRoutes);
app.use('/api/workouts', requireAuth, workoutRoutes);
app.use('/api/tests', requireAuth, testRoutes);
app.use('/api/progress', requireAuth, progressRoutes);
app.use('/api/meals', requireAuth, mealRoutes);
app.use('/api/push', requireAuth, pushRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.message?.includes('is not allowed')) {
    // A blocked origin is a configuration problem, not a server fault.
    console.warn(err.message, '- add it to CORS_ORIGIN.');
    return res.status(403).json({ error: `${err.message} Add it to CORS_ORIGIN on the server.` });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: err.message || 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  const settings = getSettings();
  console.log(`Academy Ready API listening on port ${port}`);
  console.log(`Timezone ${settings.timezone}. Plan starts ${settings.start_date}.`);

  if (configurePush()) {
    console.log('Web push configured.');
  } else {
    console.log('Web push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set. Meal plans will use the static fallback week.');
  }

  if (process.env.ENABLE_SCHEDULER !== '0') {
    startScheduler();
  } else {
    console.log('Scheduler disabled by ENABLE_SCHEDULER=0.');
  }
});
