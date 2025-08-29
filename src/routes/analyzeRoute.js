// src/routes/analyzeRoute.js
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { scrapeWebsite } from '../utils/scrapeSite.js';
import { generatePrompts, buildDevPrompt } from '../utils/generatePrompts.js';
import { callGPT } from '../utils/gptClient.js';
import { createVercelProject, createVercelChat } from '../utils/vercelClient.js';
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
    const { analysisPrompt } = await generatePrompts(htmlMap, domainSlug, siteOutputDir);

    // Step 3: Send analysis prompt to GPT
    console.log(`🧠 Calling GPT for site analysis...`);
    const analysisResult = await callGPT(analysisPrompt);
    const siteAnalysisPath = path.join(siteOutputDir, `${domainSlug}_site_analysis.txt`);
    const fullAnalysisPromptPath = path.join(siteOutputDir, `${domainSlug}_full_analysis_prompt.txt`);
    await fs.writeFile(siteAnalysisPath, analysisResult);
    await fs.writeFile(fullAnalysisPromptPath, analysisPrompt);

    // Step 4: Send developer prompt to GPT
    console.log(`💡 Calling GPT for developer prompt...`);
    const devPromptText = buildDevPrompt(analysisResult);
    const devPromptResult = await callGPT(devPromptText);
    const devPromptPath = path.join(siteOutputDir, `${domainSlug}_developer_prompt.txt`);
    const fullDevPromptPath = path.join(siteOutputDir, `${domainSlug}_full_developer_prompt.txt`);
    await fs.writeFile(devPromptPath, devPromptResult);
    await fs.writeFile(fullDevPromptPath, devPromptText);

    // Step 5: Create Vercel project and chat
    const projectId = await createVercelProject(domainSlug);
    const chatId = await createVercelChat(projectId, devPromptPath);

    return res.status(200).json({
      success: true,
      message: `Analysis completed for ${url}`,
      projectId,
      chatId,
      files: {
        siteAnalysisPath,
        fullAnalysisPromptPath,
        devPromptPath,
        fullDevPromptPath
      }
    });

  } catch (err) {
    console.error("❌ Analysis pipeline failed:", err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

export default router;
