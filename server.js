const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.use(express.static(path.join(__dirname, 'public')));

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:goalpath@app.com';
webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

const SUBS_FILE = '/tmp/subs.json';
let subs = (() => { try { return JSON.parse(fs.readFileSync(SUBS_FILE,'utf8')); } catch { return []; } })();
const saveSubs = () => { try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subs)); } catch {} };

app.get('/health', (_, res) => res.json({ status: 'OK', subscribers: subs.length }));
app.get('/vapid-public-key', (_, res) => res.json({ key: VAPID_PUBLIC }));

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid' });
  if (!subs.find(s => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(); }
  console.log(`Subscriber aggiunto. Totale: ${subs.length}`);
  res.json({ ok: true, total: subs.length });
});

app.post('/unsubscribe', (req, res) => {
  subs = subs.filter(s => s.endpoint !== req.body.endpoint);
  saveSubs(); res.json({ ok: true });
});

app.post('/test', async (req, res) => {
  const payload = JSON.stringify({ title: 'GoalPath — Test', body: 'Notifiche push attive e funzionanti!', tag: 'test' });
  let sent = 0;
  await Promise.allSettled(subs.map(async sub => {
    try { await webpush.sendNotification(sub, payload); sent++; }
    catch(e) { if (e.statusCode === 410) subs = subs.filter(s => s.endpoint !== sub.endpoint); }
  }));
  saveSubs(); res.json({ sent });
});

async function sendToAll(title, body, tag) {
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, tag, url: '/' });
  const dead = [];
  await Promise.allSettled(subs.map(async sub => {
    try { await webpush.sendNotification(sub, payload); }
    catch(e) { if (e.statusCode === 410) dead.push(sub.endpoint); }
  }));
  subs = subs.filter(s => !dead.includes(s.endpoint));
  saveSubs();
  console.log(`[${new Date().toISOString()}] Inviato "${title}" a ${subs.length} subscriber`);
}

function scheduleAt(h, m, fn) {
  const now = new Date(), t = new Date();
  t.setHours(h, m, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  const delay = t - now;
  console.log(`Notifica ${h}:${String(m).padStart(2,'0')} programmata tra ${Math.round(delay/60000)} min`);
  setTimeout(() => { fn(); scheduleAt(h, m, fn); }, delay);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GoalPath Push Server sulla porta ${PORT}`);
  scheduleAt(23, 30, () => sendToAll(
    'GoalPath — Resoconto di oggi',
    "Hai completato i tuoi task? Entro l'01:00 puoi ancora pianificare domani!",
    'goalpath-daily'
  ));
  scheduleAt(1, 0, () => sendToAll(
    'GoalPath — Ultimo avviso!',
    "Sono le 01:00 — pianifica i task di domani adesso o il giorno verrà bloccato!",
    'goalpath-deadline'
  ));
});
