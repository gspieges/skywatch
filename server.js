const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();

// ── Serve front-end with no caching ──────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ── Flight lookup via ADS-B Exchange public API ───────────────
// Uses the same data source as the map — no API key needed
app.get('/api/flights', async (req, res) => {
  req.socket.setTimeout(30000);
  res.setTimeout(30000);
  try {
    const { callsign } = req.query;
    if (!callsign) return res.status(400).json({ error: 'No callsign' });

    const cs = callsign.trim().toUpperCase();
    const url = `https://opendata.adsb.fi/api/v2/callsign/${encodeURIComponent(cs)}`;
    console.log('Fetching:', url);

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'SkyWatch/1.0', 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!resp.ok) throw new Error(`ADS-B Fi error ${resp.status}`);
    const data = await resp.json();

    // Normalize to our format
    const ac = (data.ac || data.aircraft || []).map(a => ({
      flight_icao: (a.flight || a.callsign || '').trim(),
      reg_number:  a.r || '',
      aircraft_icao: a.t || '',
      lat: a.lat,
      lng: a.lon,
      alt: typeof a.alt_baro === 'number' ? a.alt_baro : (typeof a.alt_geom === 'number' ? a.alt_geom : 0),
      speed: a.gs || 0,
      dir: a.track || 0,
      v_speed: a.baro_rate ? a.baro_rate / 196.85 : 0,
      dep_icao: a.orig_iata || '',
      arr_icao: a.dest_iata || '',
      on_ground: a.alt_baro === 'ground',
    }));

    res.json({ ac });
  } catch (err) {
    console.error('Flight lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`SkyWatch on port ${PORT}`));
server.timeout = 60000;
