const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();

const AIRLABS_KEY  = '633b6e63-163c-4019-9069-7cdb92c54936';
const AIRLABS_BASE = 'https://airlabs.co/api/v9';

async function airlabsGet(endpoint, params) {
  const qs  = new URLSearchParams({ api_key: AIRLABS_KEY, ...params }).toString();
  const url = `${AIRLABS_BASE}${endpoint}?${qs}`;
  console.log('AirLabs GET', endpoint);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(tid);
  if (!resp.ok) throw new Error(`AirLabs error ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'AirLabs error');
  return data;
}

// ── Serve front-end ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ── Flight data API ───────────────────────────────────────────
app.get('/api/flights', async (req, res) => {
  req.socket.setTimeout(60000);
  res.setTimeout(60000);
  try {
    const { callsign } = req.query;
    let data;
    if (callsign) {
      data = await airlabsGet('/flights', { flight_icao: callsign.trim().toUpperCase() });
    } else {
      data = await airlabsGet('/flights', {});
    }
    const flights = Array.isArray(data.response) ? data.response : [];
    res.json({ ac: flights });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LiveATC stream proxy ──────────────────────────────────────
// Resolves a .pls playlist to the actual mp3 stream URL,
// then pipes the audio back to the browser so it plays inline.
app.get('/api/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  // Only allow LiveATC domains for safety
  if (!url.includes('liveatc.net')) {
    return res.status(403).json({ error: 'Only LiveATC streams allowed' });
  }

  try {
    console.log('Stream proxy:', url);

    // Step 1: If it's a .pls file, fetch and parse it to get the real stream URL
    let streamUrl = url;
    if (url.endsWith('.pls') || url.includes('.pls')) {
      const plsResp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!plsResp.ok) throw new Error(`PLS fetch failed ${plsResp.status}`);
      const plsText = await plsResp.text();
      // Parse PLS format: look for File1=http://...
      const match = plsText.match(/File\d+=(.+)/i);
      if (!match) throw new Error('Could not parse PLS playlist');
      streamUrl = match[1].trim();
      console.log('Resolved stream URL:', streamUrl);
    }

    // Step 2: Proxy the actual audio stream
    const audioResp = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SkyWatch/1.0)',
        'Icy-MetaData': '0',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!audioResp.ok) throw new Error(`Stream error ${audioResp.status}`);

    // Forward audio headers
    const contentType = audioResp.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Pipe the stream directly to the response
    audioResp.body.pipe(res);

    // Handle client disconnect
    req.on('close', () => {
      console.log('Client disconnected from stream');
      audioResp.body.destroy();
    });

  } catch (err) {
    console.error('Stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`SkyWatch on port ${PORT}`));
server.timeout = 120000;
