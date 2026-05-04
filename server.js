const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
 
const app = express();
 
const AIRLABS_KEY = '633b6e63-163c-4019-9069-7cdb92c54936';
const AIRLABS_BASE = 'https://airlabs.co/api/v9';
 
async function airlabsGet(endpoint, params) {
  const qs = new URLSearchParams({ api_key: AIRLABS_KEY, ...params }).toString();
  const url = `${AIRLABS_BASE}${endpoint}?${qs}`;
  console.log('GET', url.replace(AIRLABS_KEY, '***'));
 
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);
 
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(tid);
 
  if (!resp.ok) throw new Error(`AirLabs error ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'AirLabs error');
  return data;
}
 
// Serve front-end
app.use(express.static(path.join(__dirname, 'public')));
 
// Load flights by bounding box area
app.get('/api/flights', async (req, res) => {
  req.socket.setTimeout(60000);
  res.setTimeout(60000);
  try {
    const { lat, lon, callsign } = req.query;
 
    let data;
    if (callsign) {
      // Search by flight ICAO callsign
      data = await airlabsGet('/flights', { flight_icao: callsign.trim().toUpperCase() });
    } else if (lat && lon) {
      // Get all flights and filter by distance on our side
      // AirLabs doesn't have a radius endpoint on free tier so we fetch all and filter
      data = await airlabsGet('/flights', {});
    } else {
      return res.status(400).json({ error: 'Provide callsign or lat/lon' });
    }
 
    // Normalise response into a simple array
    const flights = Array.isArray(data.response) ? data.response : [];
 
    // If searching by area, filter to within ~200nm of center
    let result = flights;
    if (lat && lon && !callsign) {
      const clat = parseFloat(lat);
      const clon = parseFloat(lon);
      result = flights.filter(f => {
        if (!f.lat || !f.lng) return false;
        const dist = Math.hypot(f.lat - clat, f.lng - clon);
        return dist < 3; // ~200nm in degrees
      });
    }
 
    res.json({ ac: result });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
 
app.get('/health', (req, res) => res.json({ status: 'ok' }));
 
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`SkyWatch on port ${PORT}`));
server.timeout = 60000;
 
