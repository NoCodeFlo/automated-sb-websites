//Puppeteer crawler
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

const MAX_DEPTH = 2;

export async function scrapeWebsite(rootUrl, outputBasePath) {
  const browser = await puppeteer.launch();
  const visited = new Set();
  const htmlMap = {};

  const urlSlug = new URL(rootUrl).hostname.replace(/[^a-z0-9]/gi, '_');
  const OUTPUT_DIR = path.join(outputBasePath, urlSlug);
  const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  async function crawl(url, depth = 0) {
    if (visited.has(url) || depth > MAX_DEPTH) return;
    visited.add(url);

    const page = await browser.newPage();
    try {
      console.log(`\uD83C\uDF10 Visiting (depth ${depth}): ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      const html = await page.content();
      const visibleText = await page.evaluate(() => document.body?.innerText || '');
      const safeName = url.replace(rootUrl, '').replace(/[^a-z0-9]/gi, '_') || 'home';

      htmlMap[url] = html;

      const htmlPath = path.join(OUTPUT_DIR, `page-${safeName}.html`);
      const txtPath = path.join(OUTPUT_DIR, `page-${safeName}.txt`);
      const screenshotPath = path.join(SCREENSHOT_DIR, `page-${safeName}.png`);

      await fs.writeFile(htmlPath, html);
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
        .filter(href => href && href.startsWith(rootUrl));

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
