require('express-async-errors');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

const app = express();
app.use(cors());
app.use(express.json());

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

// Warm client cache — persists across requests on warm serverless instances
const clientCache = new Map();

// Evict stale clients every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, entry] of clientCache) {
    if (entry.lastUsed < cutoff) {
      entry.client.disconnect().catch(() => {});
      clientCache.delete(key);
    }
  }
}, 60_000);

async function getClient(session) {
  if (session && clientCache.has(session)) {
    const cached = clientCache.get(session);
    cached.lastUsed = Date.now();
    if (!cached.client.connected) await cached.client.connect();
    return cached.client;
  }
  const client = new TelegramClient(
    new StringSession(session || ''),
    API_ID, API_HASH,
    { connectionRetries: 5 }
  );
  await client.connect();
  if (session) clientCache.set(session, { client, lastUsed: Date.now() });
  return client;
}

function getSession(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.body?.session || '';
}

function cacheClient(session, client) {
  clientCache.set(session, { client, lastUsed: Date.now() });
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries: 5 });
  await client.connect();
  const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
  const pendingSession = client.session.save();
  cacheClient(pendingSession, client);
  res.json({ ok: true, phoneCodeHash: result.phoneCodeHash, pendingSession });
});

app.post('/api/auth/verify-code', async (req, res) => {
  const { phone, code, phoneCodeHash, pendingSession } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });
  const client = await getClient(pendingSession);
  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      const newPending = client.session.save();
      cacheClient(newPending, client);
      return res.status(202).json({ requires2FA: true, pendingSession: newPending });
    }
    return res.status(400).json({ error: err.errorMessage || err.message });
  }
  const me = await client.getMe();
  const session = client.session.save();
  cacheClient(session, client);
  res.json({
    ok: true, session,
    account: {
      name: [me.firstName, me.lastName].filter(Boolean).join(' ') || phone,
      username: me.username ? '@' + me.username : null,
      phone: me.phone ? '+' + me.phone : phone,
    },
  });
});

app.post('/api/auth/verify-2fa', async (req, res) => {
  const { password, pendingSession } = req.body;
  const client = await getClient(pendingSession);
  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  const { computeCheck } = require('telegram/Password');
  const inputCheck = await computeCheck(passwordInfo, password);
  await client.invoke(new Api.auth.CheckPassword({ password: inputCheck }));
  const me = await client.getMe();
  const session = client.session.save();
  cacheClient(session, client);
  res.json({
    ok: true, session,
    account: {
      name: [me.firstName, me.lastName].filter(Boolean).join(' ') || '',
      username: me.username ? '@' + me.username : null,
      phone: me.phone ? '+' + me.phone : '',
    },
  });
});

app.post('/api/dialogs', async (req, res) => {
  const client = await getClient(getSession(req));
  const dialogs = await client.getDialogs({ limit: 500 });
  res.json(dialogs.map(d => ({
    id: d.id?.toString(),
    name: d.name || d.title || 'Unknown',
    unreadCount: d.unreadCount,
    lastMessage: d.message?.message?.slice(0, 60) || '',
    date: d.message?.date,
    isUser: d.isUser, isGroup: d.isGroup, isChannel: d.isChannel,
  })));
});

app.post('/api/messages', async (req, res) => {
  const { peerId } = req.body;
  const client = await getClient(getSession(req));
  const messages = await client.getMessages(peerId, { limit: 50 });
  const me = await client.getMe();
  res.json(messages.reverse().map(m => ({
    id: m.id, text: m.message, date: m.date,
    fromMe: m.senderId?.toString() === me.id?.toString(),
  })));
});

app.post('/api/send', async (req, res) => {
  const { peerId, text } = req.body;
  const client = await getClient(getSession(req));
  await client.sendMessage(peerId, { message: text });
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

module.exports = app;
