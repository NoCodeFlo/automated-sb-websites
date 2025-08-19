import express from 'express';
import cors from 'cors';
import { runWebsitePipeline } from './runPipeline.js';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/generate', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const result = await runWebsitePipeline(url);
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 API listening on http://localhost:${PORT}`);
});