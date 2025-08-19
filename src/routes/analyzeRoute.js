// src/routes/analyzeRoute.js
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { scrapeWebsite } from '../utils/scrapeSite.js';
import { generatePrompts } from '../utils/generatePrompts.js';
import { callGPT } from '../utils/gptClient.js';
import { createVercelProject, createVercelChat } from '../utils/vercelClient.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "url" field in request body.' });
  }

  const domainSlug = new URL(url).hostname.replace(/[^a-z0-9]/gi, '_');
  const siteOutputDir = path.join('output', domainSlug);

  try {
    console.log(`🚀 Starting analysis for: ${url}`);

    // Step 1: Scrape site
    const { htmlMap } = await scrapeWebsite(url, 'output');

    // Step 2: Generate GPT prompts
    const { analysisPrompt, devPromptText } = await generatePrompts(htmlMap, domainSlug, siteOutputDir);

    // Step 3: Send analysis prompt to GPT
    console.log(`🧠 Calling GPT for site analysis...`);
    const analysisResult = await callGPT(analysisPrompt);
    const siteAnalysisPath = path.join(siteOutputDir, `${domainSlug}_site_analysis.txt`);
    await fs.writeFile(siteAnalysisPath, analysisResult);

    // Step 4: Send developer prompt to GPT
    console.log(`💡 Calling GPT for developer prompt...`);
    const devPromptResult = await callGPT(devPromptText);
    const devPromptPath = path.join(siteOutputDir, `${domainSlug}_developer_prompt.txt`);
    await fs.writeFile(devPromptPath, devPromptResult);

    // Step 5: Create Vercel project and chat
    const projectId = await createVercelProject(domainSlug);
    const chatId = await createVercelChat(projectId, devPromptPath);

    return res.status(200).json({
      success: true,
      message: `Analysis completed for ${url}`,
      projectId,
      chatId,
      files: {
        devPromptPath,
        siteAnalysisPath
      }
    });

  } catch (err) {
    console.error("❌ Analysis pipeline failed:", err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

export default router;