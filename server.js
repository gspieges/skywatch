const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();

// ── Credentials ──────────────────────────────────────────────
const CLIENT_ID     = 'setmedicsla@gmail.com-api-client';
const CLIENT_SECRET = 'AzlQEHm0mDIX2ztXERX5s8Hb1t5QHjG8';
const TOKEN_URL     = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_BASE  = 'https://opensky-network.org/api';

// ── Token cache ───────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry  = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  console.log('Fetching new OpenSky token...');
  const resp = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token error ${resp.status}: ${text}`);
  }

  const data  = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 1800) * 1000;
  console.log('Token obtained, expires in', data.expires_in, 'seconds');
  return cachedToken;
}

// ── Serve static files (the front-end) ───────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API proxy route ───────────────────────────────────────────
app.get('/api/opensky', async (req, res) => {
  try {
    const reqPath = req.query.path || '/states/all';

    // Safety: only allow read paths
    if (!reqPath.startsWith('/states') && !reqPath.startsWith('/flights') && !reqPath.startsWith('/tracks')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const token   = await getToken();
    const url     = `${OPENSKY_BASE}${reqPath}`;
    console.log('Fetching:', url);

    const apiResp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!apiResp.ok) {
      // If token expired mid-session, clear it and retry once
      if (apiResp.status === 401) {
        cachedToken = null;
        const newToken = await getToken();
        const retry = await fetch(url, {
          headers: { Authorization: `Bearer ${newToken}` },
        });
        if (!retry.ok) return res.status(retry.status).json({ error: `OpenSky error ${retry.status}` });
        const data = await retry.json();
        return res.json(data);
      }
      return res.status(apiResp.status).json({ error: `OpenSky error ${apiResp.status}` });
    }

    const data = await apiResp.json();
    res.json(data);

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SkyWatch running on port ${PORT}`));
