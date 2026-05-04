const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();

const CLIENT_ID     = 'setmedicsla@gmail.com-api-client';
const CLIENT_SECRET = 'AzlQEHm0mDIX2ztXERX5s8Hb1t5QHjG8';
const TOKEN_URL     = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_BASE  = 'https://opensky-network.org/api';

let cachedToken = null;
let tokenExpiry  = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  console.log('Fetching new OpenSky token...');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  const resp = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    signal: controller.signal,
  });
  clearTimeout(tid);
  if (!resp.ok) { const text = await resp.text(); throw new Error(`Token error ${resp.status}: ${text}`); }
  const data  = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 1800) * 1000;
  console.log('Token OK, expires in', data.expires_in, 's');
  return cachedToken;
}

async function openSkyGet(path) {
  const token = await getToken();
  const url   = `${OPENSKY_BASE}${path}`;
  console.log('GET', url);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 55000);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  clearTimeout(tid);
  if (resp.status === 401) {
    cachedToken = null;
    const t2 = await getToken();
    const c2 = new AbortController();
    const t2id = setTimeout(() => c2.abort(), 55000);
    const r2 = await fetch(url, { headers: { Authorization: `Bearer ${t2}` }, signal: c2.signal });
    clearTimeout(t2id);
    if (!r2.ok) throw new Error(`OpenSky error ${r2.status}`);
    return r2.json();
  }
  if (!resp.ok) throw new Error(`OpenSky error ${resp.status}`);
  return resp.json();
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/opensky', async (req, res) => {
  req.socket.setTimeout(90000);
  res.setTimeout(90000);
  try {
    const reqPath = req.query.path || '/states/all';
    if (!reqPath.startsWith('/states') && !reqPath.startsWith('/flights') && !reqPath.startsWith('/tracks')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const data = await openSkyGet(reqPath);
    res.json(data);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`SkyWatch running on port ${PORT}`));
server.timeout = 90000;
