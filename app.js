// app.js
import 'dotenv/config';
import express from 'express';
import dotenv from 'dotenv';
import analyzeRoute from './src/routes/analyzeRoute.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Main analysis route
app.use('/analyze', analyzeRoute);

app.get('/', (req, res) => {
  res.send('🧠 Website Analyzer API is running.');
});

app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
});