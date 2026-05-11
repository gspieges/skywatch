const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();

// Serve front-end with no caching
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Try multiple ADS-B data sources
async function fetchFromAdsbFi(callsign) {
  const url = `https://opendata.adsb.fi/api/v2/callsign/${encodeURIComponent(callsign)}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'SkyWatch/1.0', 'Accept': 'application/json' },
    signal: controller.signal,
  });
  clearTimeout(tid);
  if (!resp.ok) throw new Error(`adsb.fi error ${resp.status}`);
  const data = await resp.json();
  return (data.ac || data.aircraft || []);
}

async function fetchFromAdsbOne(callsign) {
  const url = `https://api.adsb.one/v2/callsign/${encodeURIComponent(callsign)}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'SkyWatch/1.0', 'Accept': 'application/json' },
    signal: controller.signal,
  });
  clearTimeout(tid);
  if (!resp.ok) throw new Error(`adsb.one error ${resp.status}`);
  const data = await resp.json();
  return (data.ac || data.aircraft || []);
}

function normalizeAC(a) {
  return {
    flight_icao:  (a.flight || a.callsign || '').trim(),
    reg_number:   a.r || a.reg || '',
    aircraft_icao: a.t || a.type || '',
    lat:  a.lat,
    lng:  a.lon || a.lng,
    alt:  typeof a.alt_baro === 'number' ? a.alt_baro :
          typeof a.alt_geom === 'number' ? a.alt_geom :
          typeof a.alt === 'number' ? a.alt : 0,
    speed: a.gs || a.spd || a.speed || 0,
    dir:   a.track || a.dir || 0,
    v_speed: a.baro_rate ? a.baro_rate / 196.85 :
             a.geom_rate ? a.geom_rate / 196.85 :
             a.v_speed || 0,
    dep_icao: a.orig_iata || a.dep_icao || '',
    arr_icao: a.dest_iata || a.arr_icao || '',
    on_ground: a.alt_baro === 'ground' || a.on_ground || false,
  };
}

app.get('/api/flights', async (req, res) => {
  req.socket.setTimeout(30000);
  res.setTimeout(30000);
  try {
    const { callsign } = req.query;
    if (!callsign) return res.status(400).json({ error: 'No callsign' });
    const cs = callsign.trim().toUpperCase();

    // Try adsb.fi first, then adsb.one as fallback
    let aircraft = [];
    try {
      aircraft = await fetchFromAdsbFi(cs);
      console.log(`adsb.fi found ${aircraft.length} results for ${cs}`);
    } catch(e) {
      console.log(`adsb.fi failed: ${e.message}, trying adsb.one...`);
    }

    if (!aircraft.length) {
      try {
        aircraft = await fetchFromAdsbOne(cs);
        console.log(`adsb.one found ${aircraft.length} results for ${cs}`);
      } catch(e) {
        console.log(`adsb.one failed: ${e.message}`);
      }
    }

    const ac = aircraft.map(normalizeAC).filter(f => f.lat && f.lng);
    res.json({ ac });
  } catch (err) {
    console.error('Flight lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`SkyWatch on port ${PORT}`));
server.timeout = 60000;
