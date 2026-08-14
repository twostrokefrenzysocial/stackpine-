import { Router } from 'express';
import { db, getSettings } from '../db.js';
import {
  createSession,
  destroySession,
  destroyAllSessions,
  hashPin,
  requireAuth,
  verifyPin,
} from '../auth.js';

const router = Router();

// Very small brute force guard for a single user app.
let failures = 0;
let lockedUntil = 0;

router.post('/login', (req, res) => {
  if (Date.now() < lockedUntil) {
    const seconds = Math.ceil((lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${seconds} seconds.` });
  }

  const { pin } = req.body || {};
  const settings = getSettings();
  if (!settings?.pin_hash) return res.status(500).json({ error: 'No PIN is set on the server.' });

  if (!pin || !verifyPin(pin, settings.pin_hash)) {
    failures += 1;
    if (failures >= 5) {
      lockedUntil = Date.now() + 60_000;
      failures = 0;
    }
    return res.status(401).json({ error: 'That PIN is not right.' });
  }

  failures = 0;
  const session = createSession();
  return res.json({ token: session.token, expires_at: session.expires_at, name: settings.name });
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const settings = getSettings();
  res.json({ name: settings.name, timezone: settings.timezone });
});

router.post('/change-pin', requireAuth, (req, res) => {
  const { current_pin: currentPin, new_pin: newPin } = req.body || {};
  const settings = getSettings();
  if (!verifyPin(currentPin, settings.pin_hash)) {
    return res.status(401).json({ error: 'The current PIN is not right.' });
  }
  const pin = String(newPin || '');
  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'Pick a new PIN of 4 to 8 digits.' });
  }
  db.prepare("UPDATE settings SET pin_hash = ?, updated_at = datetime('now') WHERE id = 1").run(
    hashPin(pin)
  );
  destroyAllSessions();
  const session = createSession();
  res.json({ ok: true, token: session.token, expires_at: session.expires_at });
});

export default router;
