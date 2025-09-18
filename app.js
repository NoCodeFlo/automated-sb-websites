// app.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import analyzeRoute from './src/routes/analyzeRoute.js';

const app = express();
const port = process.env.PORT || 3000;
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output';

app.use(express.json({ limit: '10mb' }));

// Allow CORS for external callers (configure with CORS_ORIGIN if needed)
app.use(cors({ origin: process.env.CORS_ORIGIN || '*'}));

// Serve generated output files immediately
app.use('/files', express.static(OUTPUT_DIR, { index: false, cacheControl: false }));

// Optional API key protection (enabled when API_KEY is set)
function requireApiKey(req, res, next) {
  const key = process.env.API_KEY;
  if (!key) return next(); // no API key set -> public
  const provided = req.header('x-api-key') || req.query.api_key;
  if (provided && provided === key) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Main analysis route (protected when API_KEY is set)
app.use('/analyze', requireApiKey, analyzeRoute);

app.get('/', (req, res) => {
  res.send('🧠 Website Analyzer API is running.');
});

// Health check
app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// Light directory index helpers for outputs
app.get('/outputs', async (req, res) => {
  try {
    const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
    const slugs = entries.filter(e => e.isDirectory()).map(e => e.name);
    res.json({ slugs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/outputs/:slug', async (req, res) => {
  const { slug } = req.params;
  const base = path.join(OUTPUT_DIR, slug);
  const maxDepth = Math.min(5, parseInt(req.query.depth || '3', 10) || 3);
  async function walk(dir, depth, acc = [], relBase = '') {
    if (depth < 0) return acc;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
      const rel = path.join(relBase, e.name);
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        acc.push({ type: 'dir', path: rel });
        await walk(full, depth - 1, acc, rel);
      } else {
        acc.push({ type: 'file', path: rel });
      }
    }
    return acc;
  }
  try {
    const listing = await walk(base, maxDepth);
    res.json({ slug, files: listing });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
  if (!process.env.API_KEY) {
    console.warn('⚠️ API_KEY not set — /analyze is public. Set API_KEY in .env to protect it.');
  }
});
