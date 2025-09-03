import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import { buildAnalysisPrompt } from './src/utils/generatePrompts.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Apply stealth plugin globally
puppeteer.use(StealthPlugin());
const rootUrl = "https://lichtweg.li/";
const urlSlug = new URL(rootUrl).hostname.replace(/[^a-z0-9]/gi, '_');
const OUTPUT_BASE_DIR = "output";
const WEBSITE_DIR = path.join(OUTPUT_BASE_DIR, urlSlug);
const SCREENSHOT_DIR = path.join(WEBSITE_DIR, "screenshots");
const SAVE_HTML = true;
const MAX_DEPTH = 2;
const GPT_CHAR_LIMIT = 120000 * 3;

if (!OPENAI_API_KEY) {
  console.error("❌ Missing OpenAI API key in .env file.");
  process.exit(1);
}

async function crawlWebsite(rootUrl) {
  const browser = await puppeteer.launch();
  const visited = new Set();
  const htmlMap = {};

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  async function crawl(url, depth = 0) {
    if (visited.has(url) || depth > MAX_DEPTH) return;
    visited.add(url);

    const page = await browser.newPage();
    try {
      console.log(`🌐 Visiting (depth ${depth}): ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      const html = await page.content();
      const safeName = url.replace(rootUrl, '').replace(/[^a-z0-9]/gi, '_') || 'home';

      htmlMap[url] = html;

      if (SAVE_HTML) {
        const htmlPath = path.join(WEBSITE_DIR, `page-${safeName}.html`);
        const txtPath = path.join(WEBSITE_DIR, `page-${safeName}.txt`);
        const screenshotPath = path.join(SCREENSHOT_DIR, `page-${safeName}.png`);

        await fs.writeFile(htmlPath, html);
        await fs.writeFile(txtPath, html);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        console.log(`✅ Saved: ${htmlPath} + .txt + screenshot`);
      }

      const rawLinks = await page.$$eval('a[href]', anchors =>
        anchors
          .map(a => a.getAttribute('href'))
          .filter(href => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('javascript:'))
      );

      const resolvedLinks = rawLinks.map(href => {
        try {
          return new URL(href, url).toString();
        } catch {
          return null;
        }
      }).filter(href => href && href.startsWith(rootUrl));

      await page.close();

      for (const link of resolvedLinks) {
        await crawl(link, depth + 1);
      }
    } catch (err) {
      console.error(`❌ Error visiting ${url}: ${err.message}`);
      await page.close();
    }
  }

  await crawl(rootUrl, 0);
  await browser.close();
  return htmlMap;
}

// Removed legacy developer-prompt builder (single-pass flow only)

async function callGPT(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

(async () => {
  try {
    const htmlMap = await crawlWebsite(rootUrl);
    console.log(`\n✅ Scraped ${Object.keys(htmlMap).length} unique pages.`);

    const analysisPrompt = buildAnalysisPrompt(htmlMap, rootUrl);
    await fs.writeFile(path.join(WEBSITE_DIR, `${urlSlug}_full_analysis_prompt.txt`), analysisPrompt);

    const gptTruncatedPrompt = analysisPrompt.slice(0, GPT_CHAR_LIMIT);

    console.log("\n🧠 Sending analysis to GPT...");
    const analysis = await callGPT(gptTruncatedPrompt);
    await fs.writeFile(path.join(WEBSITE_DIR, `${urlSlug}_site_analysis.txt`), analysis);

    console.log("\n✅ Single-pass complete. v0-ready prompt saved as site_analysis.txt");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
