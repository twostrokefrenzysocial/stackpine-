import crypto from 'node:crypto';
import { db, getSettings } from './db.js';

const SESSION_DAYS = 365;

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPin(pin, stored) {
  if (!stored) return false;
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expires);
  return { token, expires_at: expires };
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function destroyAllSessions() {
  db.prepare('DELETE FROM sessions').run();
}

function readToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return null;
}

export function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'Not signed in' });
  if (row.expires_at < new Date().toISOString()) {
    destroySession(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.token = token;
  req.settings = getSettings();
  return next();
}

export function pruneExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
