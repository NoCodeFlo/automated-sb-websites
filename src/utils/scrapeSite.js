// Puppeteer crawler with stealth evasion
import puppeteer from 'puppeteer-extra';
import { executablePath as chromeExecutablePath } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

const MAX_DEPTH = 2;

// Apply stealth plugin to reduce automation fingerprints
puppeteer.use(StealthPlugin());

export async function scrapeWebsite(rootUrl, outputBasePath) {
  // Try to resolve a Chromium binary that works in container/serverless first
  let args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
  ];
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '';
  let headless = true;

  let usingChromium = false;
  try {
    const ep = await chromium.executablePath(process.env.CHROMIUM_EXEC_PATH);
    if (ep) {
      executablePath = ep;
      args = [...chromium.args, ...args];
      headless = chromium.headless;
      usingChromium = true;
    }
  } catch {/* ignore and fall back */}

  if (!usingChromium && !executablePath) {
    try { executablePath = chromeExecutablePath(); } catch {/* ignore */}
  }

  const browser = await puppeteer.launch({ args, headless, executablePath });
  const visited = new Set();
  const htmlMap = {};

  const urlSlug = new URL(rootUrl).hostname.replace(/[^a-z0-9]/gi, '_');
  const OUTPUT_DIR = path.join(outputBasePath, urlSlug);
  const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  function sameHost(a, b) {
    try {
      const ah = new URL(a).hostname.replace(/^www\./, '');
      const bh = new URL(b).hostname.replace(/^www\./, '');
      return ah === bh;
    } catch {
      return false;
    }
  }

  async function crawl(url, depth = 0) {
    if (visited.has(url) || depth > MAX_DEPTH) return;
    visited.add(url);

    const page = await browser.newPage();
    try {
      console.log(`\uD83C\uDF10 Visiting (depth ${depth}): ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      let html = await page.content();
      // Inline cleaning: remove non-content elements and noisy attrs
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const titleText = titleMatch ? titleMatch[1].trim() : '';
      html = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<template[\s\S]*?<\/template>/gi, '')
        .replace(/<!--([\s\S]*?)-->/g, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '');
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let cleanedHtml = bodyMatch ? bodyMatch[1] : html;
      cleanedHtml = cleanedHtml.replace(/\s(on[a-z]+|style|data-[\w-]+)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      cleanedHtml = cleanedHtml
        .replace(/\r/g, '')
        .replace(/\t/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .replace(/[ \f\v]+/g, ' ')
        .trim();
      if (titleText) {
        cleanedHtml = `<title>${titleText}</title>\n${cleanedHtml}`;
      }
      const visibleText = await page.evaluate(() => document.body?.innerText || '');
      const safeName = url.replace(rootUrl, '').replace(/[^a-z0-9]/gi, '_') || 'home';

      htmlMap[url] = cleanedHtml;

      const htmlPath = path.join(OUTPUT_DIR, `page-${safeName}.html`);
      const txtPath = path.join(OUTPUT_DIR, `page-${safeName}.txt`);
      const screenshotPath = path.join(SCREENSHOT_DIR, `page-${safeName}.png`);

      await fs.writeFile(htmlPath, cleanedHtml);
      await fs.writeFile(txtPath, visibleText);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      console.log(`✅ Saved: ${htmlPath} + .txt + screenshot`);

      const rawLinks = await page.$$eval('a[href]', anchors =>
        anchors
          .map(a => a.getAttribute('href'))
          .filter(href => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('javascript:'))
      );

      const resolvedLinks = rawLinks
        .map(href => {
          try {
            return new URL(href, url).toString();
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        // Only follow links on the same host (ignore www prefix differences)
        .filter(href => sameHost(href, rootUrl));

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
  return { htmlMap, urlSlug, OUTPUT_DIR };
}
