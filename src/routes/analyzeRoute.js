// src/routes/analyzeRoute.js
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { scrapeWebsite } from '../utils/scrapeSite.js';
import { generatePrompts, buildRefinementPrompt } from '../utils/generatePrompts.js';
import { callGPT } from '../utils/gptClient.js';
import { slugifyUrl } from '../utils/slugifyUrl.js';
import { withLock } from '../utils/mutex.js';

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

    // Step 2: Generate iterative prompts (homepage + up to 4 refinements)
    const { analysisPrompt, refinementPages } = await generatePrompts(htmlMap, url, siteOutputDir);

    // Step 3: Run GPT iteratively and persist intermediate artifacts
    const iterationsDir = path.join(siteOutputDir, 'iterations');
    await fs.mkdir(iterationsDir, { recursive: true });

    console.log(`🧠 Iteration 1: initial analysis from homepage...`);
    const step1Response = await callGPT(analysisPrompt);
    await fs.writeFile(path.join(iterationsDir, `01_initial_prompt.txt`), analysisPrompt);
    await fs.writeFile(path.join(iterationsDir, `01_response.txt`), step1Response);

    let currentOutput = step1Response;
    let lastPromptSent = analysisPrompt;

    // Refinements: incorporate next important pages one by one (up to 4 more)
    for (let i = 0; i < refinementPages.length; i++) {
      const stepIndex = i + 2; // human-friendly step count
      const { url: pageUrl, html: pageHtml } = refinementPages[i];
      console.log(`🧠 Iteration ${stepIndex}: refining with ${pageUrl}`);

      const refinePrompt = buildRefinementPrompt(currentOutput, pageHtml);
      const refineResponse = await callGPT(refinePrompt);

      const indexStr = String(stepIndex).padStart(2, '0');
      await fs.writeFile(path.join(iterationsDir, `${indexStr}_refine_prompt.txt`), refinePrompt);
      await fs.writeFile(path.join(iterationsDir, `${indexStr}_response.txt`), refineResponse);

      currentOutput = refineResponse;
      lastPromptSent = refinePrompt;
    }

    const siteAnalysisPath = path.join(siteOutputDir, `${domainSlug}_site_analysis.txt`);
    const fullAnalysisPromptPath = path.join(siteOutputDir, `${domainSlug}_full_analysis_prompt.txt`);
    // Save the final refined output and the last prompt that produced it
    await fs.writeFile(siteAnalysisPath, currentOutput);
    await fs.writeFile(fullAnalysisPromptPath, lastPromptSent);

    // Step 4-6: Optionally create Vercel project, chat, wait for version, and deploy
    // Skip if SKIP_V0 env is set or if no VERCEL_API_KEY is present
    let projectId = null;
    let chatId = null;
    let deployment = null;
    const skipV0 = process.env.SKIP_V0 === '1' || process.env.SKIP_VERCEL === '1';
    if (skipV0) {
      console.log('⏭️  SKIP_V0 enabled: skipping Vercel project/chat creation.');
    } else if (!process.env.VERCEL_API_KEY) {
      console.log('⏭️  No VERCEL_API_KEY found: skipping Vercel project/chat creation.');
    } else {
      const { createVercelProject, createVercelChat } = await import('../utils/vercelClient.js');
      const { waitForChatVersion, createDeployment } = await import('../utils/v0Platform.js');
      const { fetchJson } = await import('../utils/http.js');

      const projectIdPath = path.join(siteOutputDir, `${domainSlug}_v0_projectId.txt`);
      const chatIdPath = path.join(siteOutputDir, `${domainSlug}_v0_chatId.txt`);
      const deploymentPath = path.join(siteOutputDir, `${domainSlug}_v0_deployment.json`);

      // Guard entire v0 create flow with a per-site lock to avoid duplicate calls
      const result = await withLock(domainSlug, async () => {
        let existingProjectId = null;
        let existingChatId = null;
        let existingDeployment = null;

        try { existingProjectId = (await fs.readFile(projectIdPath, 'utf-8')).trim(); } catch {}
        try { existingChatId = (await fs.readFile(chatIdPath, 'utf-8')).trim(); } catch {}
        try {
          const raw = await fs.readFile(deploymentPath, 'utf-8');
          existingDeployment = JSON.parse(raw);
        } catch {}

        const finalProjectId = existingProjectId || await createVercelProject(`Website rebuild: ${url}`);
        if (!existingProjectId) await fs.writeFile(projectIdPath, finalProjectId);

        const finalChatId = existingChatId || await createVercelChat(finalProjectId, siteAnalysisPath);
        if (!existingChatId) await fs.writeFile(chatIdPath, finalChatId);

        // Wait for initial version to be ready, then deploy (idempotent on file presence)
        let finalDeployment = existingDeployment;
        let createdNewDeployment = false;
        if (!finalDeployment) {
          const versionId = await waitForChatVersion(finalChatId);
          finalDeployment = await createDeployment({ projectId: finalProjectId, chatId: finalChatId, versionId });
          await fs.writeFile(deploymentPath, JSON.stringify(finalDeployment, null, 2));
          createdNewDeployment = true;
        }

        return { finalProjectId, finalChatId, finalDeployment, createdNewDeployment };
      });

      projectId = result.finalProjectId;
      chatId = result.finalChatId;
      deployment = result.finalDeployment;

      // Final step: notify webhook on new publish
      if (deployment?.webUrl && result.createdNewDeployment) {
        try {
          await fetchJson('POST', 'https://hooks.zapier.com/hooks/catch/17663707/umsr9pp/', {
            auth: false,
            headers: { 'Content-Type': 'application/json' },
            body: { originalUrl: url, newUrl: deployment.webUrl },
            retry: { attempts: 3, baseMs: 300 },
          });
        } catch (whErr) {
          console.warn('⚠️ Webhook notification failed:', whErr.message);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Analysis completed for ${url}`,
      projectId,
      chatId,
      deployment,
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
