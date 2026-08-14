import { Router } from 'express';
import {
  publicKey,
  pushReady,
  saveSubscription,
  removeSubscription,
  listSubscriptions,
  sendToAll,
} from '../services/notifications.js';
import { runDueNotifications } from '../services/scheduler.js';

const router = Router();

// The public key is safe to hand to the browser. The private key never leaves
// the server.
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: publicKey(), configured: pushReady() });
});

router.get('/subscriptions', (req, res) => {
  res.json({ subscriptions: listSubscriptions(), configured: pushReady() });
});

router.post('/subscribe', (req, res) => {
  try {
    saveSubscription(req.body?.subscription, req.body?.label || null);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'Send the endpoint to remove.' });
  removeSubscription(endpoint);
  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  const result = await sendToAll({
    title: 'Academy Ready',
    body: 'Push notifications are working on this device.',
    tag: 'test',
    url: '/',
  });
  res.json(result);
});

// Manual trigger, handy for checking the schedule without waiting for the clock.
router.post('/run-due', async (req, res) => {
  const fired = await runDueNotifications();
  res.json({ fired });
});

export default router;
