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

    // Derive a short business name from homepage title or domain for Vercel project naming/aliasing
    function getHomepageHtml(map, rootUrl) {
      if (map[rootUrl]) return map[rootUrl];
      try {
        const u = new URL(rootUrl);
        const variants = new Set([
          rootUrl,
          rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : `${rootUrl}/`,
          `${u.protocol}//${u.host}/`,
          `${u.protocol}//${u.host}`,
          `https://${u.host}/`,
          `http://${u.host}/`,
          `https://www.${u.hostname.replace(/^www\./,'')}/`,
          `http://www.${u.hostname.replace(/^www\./,'')}/`,
          `https://${u.hostname.replace(/^www\./,'')}/`,
          `http://${u.hostname.replace(/^www\./,'')}/`,
        ]);
        for (const k of variants) { if (map[k]) return map[k]; }
      } catch {}
      // Fallback: first HTML value
      const first = Object.values(map)[0];
      return typeof first === 'string' ? first : '';
    }

    function deriveProjectName(map, rootUrl) {
      const html = getHomepageHtml(map, rootUrl) || '';
      const tMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      let title = tMatch ? (tMatch[1] || '').trim() : '';
      // Split on common separators and pick a meaningful token
      const SEP = /[\-|–—:•·\|]/;
      const STOP = new Set(['home','startseite','willkommen','welcome','homepage','accueil']);
      let candidate = '';
      if (title) {
        const parts = title.split(SEP).map(s => s.trim()).filter(Boolean);
        // Prefer the longest token that isn't a stopword
        const ranked = parts
          .map(s => s.replace(/[\s\u00A0]+/g,' ').trim())
          .filter(s => s && !STOP.has(s.toLowerCase()))
          .sort((a,b)=> b.length - a.length);
        candidate = ranked[0] || parts[0] || '';
      }
      if (!candidate) {
        try {
          const h = new URL(rootUrl).hostname.replace(/^www\./,'');
          const label = h.split('.')[0];
          candidate = label.replace(/[-_]+/g,' ').trim();
        } catch { candidate = 'website'; }
      }
      // Shorten overly long names
      if (candidate.length > 50) candidate = candidate.slice(0,50).trim();
      // Capitalize words
      candidate = candidate.replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
      return candidate;
    }

    function slugForSubdomain(name) {
      const base = (name || 'site')
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // strip accents
        .toLowerCase()
        .replace(/&/g,'-and-')
        .replace(/[^a-z0-9]+/g,'-')
        .replace(/^-+|-+$/g,'')
        .slice(0, 63) || 'site';
      return base;
    }

    const projectName = deriveProjectName(htmlMap, url);
    const projectSlug = slugForSubdomain(projectName);
    const projectSubdomain = `${projectSlug}.vercel.app`;

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
      const { waitForChatVersion, createDeployment, waitForDeploymentReady, assignAlias, addProjectDomain, getChat } = await import('../utils/v0Platform.js');
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

        const finalProjectId = existingProjectId || await createVercelProject(projectName);
        if (!existingProjectId) await fs.writeFile(projectIdPath, finalProjectId);

        const finalChatId = existingChatId || await createVercelChat(finalProjectId, siteAnalysisPath);
        if (!existingChatId) await fs.writeFile(chatIdPath, finalChatId);

        // Wait for initial version to be ready, then deploy (idempotent on file presence)
        let finalDeployment = existingDeployment;
        let createdNewDeployment = false;
        if (!finalDeployment) {
          // Ensure chat latest version is fully completed
          const versionId = await waitForChatVersion(finalChatId);
          // Extra safety: ensure the chat detail doesn't show errors
          try {
            const chatDetail = await getChat(finalChatId);
            const v = chatDetail?.latestVersion;
            const errs = (v?.errors && v.errors.length > 0) ? v.errors : [];
            if (errs.length > 0) {
              throw new Error(`Chat latest version has errors: ${JSON.stringify(errs).slice(0, 500)}`);
            }
          } catch (chatErr) {
            throw chatErr;
          }
          
          finalDeployment = await createDeployment({ projectId: finalProjectId, chatId: finalChatId, versionId });
          // Wait for deployment to become ready and return status
          try {
            const ready = await waitForDeploymentReady(finalDeployment.id);
            finalDeployment.status = ready.status || 'completed';
            finalDeployment.webUrl = ready.webUrl || finalDeployment.webUrl;
            finalDeployment.inspectorUrl = ready.inspectorUrl || finalDeployment.inspectorUrl;
          } catch (depErr) {
            // Surface failure with partial details
            const e = new Error(`Deployment did not become ready: ${depErr.message}`);
            e.deployment = finalDeployment;
            throw e;
          }
          await fs.writeFile(deploymentPath, JSON.stringify(finalDeployment, null, 2));
          createdNewDeployment = true;
        }

        return { finalProjectId, finalChatId, finalDeployment, createdNewDeployment };
      });

      projectId = result.finalProjectId;
      chatId = result.finalChatId;
      deployment = result.finalDeployment;

      // Optional: assign custom alias if configured
      // Always use project name as subdomain for alias, e.g. <project>.vercel.app
      const desiredAlias = projectSubdomain;
      let aliasResult = null;
      let aliasToUse = desiredAlias;
      if (deployment?.id && desiredAlias) {
        try {
          // For *.vercel.app aliases, directly assign; no domain-adding needed
          aliasResult = await assignAlias({ deploymentId: deployment.id, alias: desiredAlias });
        } catch (e) {
          console.warn('⚠️ Alias step encountered an error:', e.message || String(e));
          // If alias is taken or not allowed, attempt a few suffix variants
          for (let i = 0; i < 3 && !aliasResult; i++) {
            const suffix = Math.random().toString(36).slice(2, 6);
            aliasToUse = `${projectSlug}-${suffix}.vercel.app`;
            try {
              aliasResult = await assignAlias({ deploymentId: deployment.id, alias: aliasToUse });
            } catch { /* try next */ }
          }
        }
      }

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
      status: {
        chat: 'completed',
        deployment: deployment?.status || 'unknown',
        alias: aliasResult ? 'assigned' : 'failed',
      },
      files: {
        siteAnalysisPath,
        fullAnalysisPromptPath,
        // Single-pass: no separate developer prompt files
      },
      projectName,
      alias: aliasToUse
    });

  } catch (err) {
    console.error("❌ Analysis pipeline failed:", err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

export default router;
