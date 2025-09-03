// src/routes/analyzeRoute.js
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { scrapeWebsite } from '../utils/scrapeSite.js';
import { generatePrompts } from '../utils/generatePrompts.js';
import { callGPT } from '../utils/gptClient.js';
import { slugifyUrl } from '../utils/slugifyUrl.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "url" field in request body.' });
  }

  const domainSlug = slugifyUrl(url);
  const siteOutputDir = path.join('output', domainSlug);

  try {
    console.log(`🚀 Starting analysis for: ${url}`);

    // Step 1: Scrape site
    const { htmlMap } = await scrapeWebsite(url, 'output');

    // Step 2: Generate GPT prompts
    // Single-pass: build one prompt that yields a v0-ready brief
    const { analysisPrompt } = await generatePrompts(htmlMap, url, siteOutputDir);

    // Step 3: Send analysis prompt to GPT
    console.log(`🧠 Calling GPT for site analysis...`);
    const analysisResult = await callGPT(analysisPrompt);
    const siteAnalysisPath = path.join(siteOutputDir, `${domainSlug}_site_analysis.txt`);
    const fullAnalysisPromptPath = path.join(siteOutputDir, `${domainSlug}_full_analysis_prompt.txt`);
    await fs.writeFile(siteAnalysisPath, analysisResult);
    await fs.writeFile(fullAnalysisPromptPath, analysisPrompt);

    // Step 4: Optionally create Vercel project and chat
    // Skip if SKIP_V0 env is set or if no VERCEL_API_KEY is present
    let projectId = null;
    let chatId = null;
    const skipV0 = process.env.SKIP_V0 === '1' || process.env.SKIP_VERCEL === '1';
    if (skipV0) {
      console.log('⏭️  SKIP_V0 enabled: skipping Vercel project/chat creation.');
    } else if (!process.env.VERCEL_API_KEY) {
      console.log('⏭️  No VERCEL_API_KEY found: skipping Vercel project/chat creation.');
    } else {
      const { createVercelProject, createVercelChat } = await import('../utils/vercelClient.js');
      projectId = await createVercelProject(`Website rebuild: ${url}`);
      chatId = await createVercelChat(projectId, siteAnalysisPath);
    }

    return res.status(200).json({
      success: true,
      message: `Analysis completed for ${url}`,
      projectId,
      chatId,
      files: {
        siteAnalysisPath,
        fullAnalysisPromptPath,
        // Single-pass: no separate developer prompt files
      }
    });

  } catch (err) {
    console.error("❌ Analysis pipeline failed:", err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

export default router;
