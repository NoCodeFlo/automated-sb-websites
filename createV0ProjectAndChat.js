import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { createVercelProject, createVercelChat } from './src/utils/vercelClient.js';
import { slugifyUrl } from './src/utils/slugifyUrl.js';

// Example usage script to create a v0 project & chat using the same
// client and env var as the main pipeline.

const VERCEL_API_KEY = process.env.VERCEL_API_KEY;

// Accept URL via CLI flag or env var; no hardcoded default.
function parseUrlArg() {
  const idx = process.argv.findIndex(a => a === '--url' || a === '-u');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const inline = process.argv.find(a => a.startsWith('--url='));
  if (inline) return inline.split('=')[1];
  return process.env.URL || process.env.ROOT_URL || '';
}

const rootUrl = parseUrlArg();
if (!rootUrl) {
  console.error('❌ Missing URL. Provide with --url <https://...> or set URL env.');
  process.exit(1);
}

const slug = slugifyUrl(rootUrl);
const OUTPUT_BASE_DIR = process.env.OUTPUT_DIR || 'output';
const siteAnalysisFile = path.join(OUTPUT_BASE_DIR, slug, `${slug}_site_analysis.txt`);

if (!VERCEL_API_KEY) {
  console.error('❌ Missing VERCEL_API_KEY in .env');
  process.exit(1);
}

(async () => {
  try {
    const promptContent = await fs.readFile(siteAnalysisFile, 'utf-8');

    const projectName = `Website rebuild: ${rootUrl}`;
    const projectId = await createVercelProject(projectName);
    console.log('✅ Project created:', projectId);

    const chatId = await createVercelChat(projectId, siteAnalysisFile);
    console.log('✅ Chat created:', chatId);

    await fs.writeFile(path.join('output', slug, `${slug}_v0_projectId.txt`), projectId);
    await fs.writeFile(path.join('output', slug, `${slug}_v0_chatId.txt`), chatId);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
