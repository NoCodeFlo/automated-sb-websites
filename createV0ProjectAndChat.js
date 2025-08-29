import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { createVercelProject, createVercelChat } from './src/utils/vercelClient.js';

// Example usage script to create a v0 project & chat using the same
// client and env var as the main pipeline.

const VERCEL_API_KEY = process.env.VERCEL_API_KEY;
const rootUrl = process.env.ROOT_URL || 'https://lichtweg.li/';
const slug = new URL(rootUrl).hostname.replace(/[^a-z0-9]/gi, '_');
const devPromptFile = path.join('output', slug, `${slug}_developer_prompt.txt`);

if (!VERCEL_API_KEY) {
  console.error('❌ Missing VERCEL_API_KEY in .env');
  process.exit(1);
}

(async () => {
  try {
    const promptContent = await fs.readFile(devPromptFile, 'utf-8');

    const projectName = `Website rebuild: ${rootUrl}`;
    const projectId = await createVercelProject(projectName);
    console.log('✅ Project created:', projectId);

    const chatId = await createVercelChat(projectId, devPromptFile);
    console.log('✅ Chat created:', chatId);

    await fs.writeFile(path.join('output', slug, `${slug}_v0_projectId.txt`), projectId);
    await fs.writeFile(path.join('output', slug, `${slug}_v0_chatId.txt`), chatId);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
