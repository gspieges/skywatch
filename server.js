const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();

// ADS-B One API — free, no auth, no blocked connections
const ADSB_BASE = 'https://api.adsb.one/v2';

async function adsbGet(path) {
  const url = `${ADSB_BASE}${path}`;
  console.log('GET', url);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: controller.signal,
  });
  clearTimeout(tid);

  if (!resp.ok) throw new Error(`ADS-B error ${resp.status}`);
  return resp.json();
}

// Serve front-end
app.use(express.static(path.join(__dirname, 'public')));

// API proxy — translates our requests to ADS-B One format
app.get('/api/flights', async (req, res) => {
  req.socket.setTimeout(60000);
  res.setTimeout(60000);

  try {
    const { lat, lon, radius, callsign } = req.query;

    let path;
    if (callsign) {
      path = `/callsign/${encodeURIComponent(callsign.trim().toUpperCase())}`;
    } else if (lat && lon) {
      const r = Math.min(parseFloat(radius) || 150, 250);
      path = `/lat/${parseFloat(lat).toFixed(4)}/lon/${parseFloat(lon).toFixed(4)}/dist/${r}`;
    } else {
      return res.status(400).json({ error: 'Provide callsign or lat/lon' });
    }

    const data = await adsbGet(path);
    res.json(data);

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`SkyWatch on port ${PORT}`));
server.timeout = 60000;
