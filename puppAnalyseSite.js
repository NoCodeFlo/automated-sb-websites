import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const rootUrl = "https://lichtweg.li/";
const OUTPUT_DIR = "output";
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, "screenshots");
const SAVE_HTML = true;
const MAX_DEPTH = 2;
const GPT_CHAR_LIMIT = 120000 * 3; // Tripled GPT input limit

const urlSlug = new URL(rootUrl).hostname.replace(/[^a-z0-9]/gi, '_');

if (!OPENAI_API_KEY) {
  console.error("\u274c Missing OpenAI API key in .env file.");
  process.exit(1);
}

async function crawlWebsite(rootUrl) {
  const browser = await puppeteer.launch();
  const visited = new Set();
  const htmlMap = {};

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  async function crawl(url, depth = 0) {
    if (visited.has(url) || depth > MAX_DEPTH) return;
    visited.add(url);

    const page = await browser.newPage();
    try {
      console.log(`\ud83c\udf10 Visiting (depth ${depth}): ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      const html = await page.content();
      const safeName = url.replace(rootUrl, '').replace(/[^a-z0-9]/gi, '_') || 'home';

      htmlMap[url] = html;

      if (SAVE_HTML) {
        const htmlPath = path.join(OUTPUT_DIR, `page-${safeName}.html`);
        const txtPath = path.join(OUTPUT_DIR, `page-${safeName}.txt`);
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

function buildAnalysisPrompt(htmlMap) {
  let prompt = `
You are a professional web designer tasked with analyzing the structure and content of a real website. You will receive the full raw HTML of the homepage and all sub-pages.

Your goal is to help a new designer rebuild the website based on the actual structure and content — reusing existing materials wherever possible.

Please follow these instructions carefully:

---

**Text content**:
- Use the **exact text found in the HTML** wherever possible.
- If a page or section contains **no visible text**, try to come up with **suitable placeholder text** based on the business context (e.g., acupuncture clinic), as long as it is **generic and plausible**.
- However, you must **never invent or guess** any **names, contact details, addresses, prices, schedules, or personal data**.

---

**Images**:
- Use "alt" attributes to describe images when available.
- If no "alt" text exists, write “No alt text available.”

---

**Design & structure**:
For each page, describe:
1. The **page URL**
2. The **purpose** of the page (based on structure and content)
3. The **overall layout** and page sections
4. The **main headings** ("h1"–"h6")
5. The **text content** (reusing exact HTML text if possible)
6. The **image content** (provide link to hosted images)
7. The **primary and secondary colors (in HEX)** if visible in inline styles or CSS

---

Please format your output clearly, grouping the analysis by page.
`.trim();

  for (const [url, html] of Object.entries(htmlMap)) {
    prompt += `\n\n--- PAGE: ${url} ---\n${html}`;
  }

  return prompt;
}

function buildDevPrompt(analysisText) {
  return `
You are an experienced senior web designer and mentor.

You are reviewing the following detailed analysis of a website (its purpose, structure, content, design elements, color schemes, etc.).

Your task is to generate a clear, structured and actionable prompt for a **junior web developer** who will be responsible for rebuilding this website.

The new version of the site should:
- Reuse the **existing content** (text, structure, purpose)
- Not come up with new content that is fully made up
- Stay consistent with the **existing design language** (e.g., colors, layout, mood)
- Apply **modern web design best practices** for usability, accessibility, responsiveness, and simplicity
- Result in a **visually improved, more user-friendly version** of the original site
- If there is any pages linking to social media (instagram, facebook) include the existing external link on the website, but don't try rebulild any of the social media pages

Make sure your developer prompt includes:
1. The URL of the website that will be rebuilt
2. An overview of the project and goals
3. A section-by-section breakdown of what the developer should implement for each page
4. When mentioning images, provide the direct URL to the hosted image if possible (only if it exists)
5. Specific frontend technologies or frameworks to consider (optional)
6. Any constraints or important content that must not be changed
7. Tone and feel of the new design (e.g., modern, clean, warm, etc.)
8. Deliverables: focus on the design and implementation of the page and do not specifically mention any plugins, configurations or creation of readme documentations

---

Below is the original website analysis:

${analysisText}
`.trim();
}

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

    const analysisPrompt = buildAnalysisPrompt(htmlMap);
    await fs.writeFile(`${urlSlug}_full_analysis_prompt.txt`, analysisPrompt);

    const gptTruncatedPrompt = analysisPrompt.slice(0, GPT_CHAR_LIMIT);

    console.log("\n🧠 Sending analysis to GPT...");
    const analysis = await callGPT(gptTruncatedPrompt);
    await fs.writeFile(`${urlSlug}_site_analysis.txt`, analysis);

    console.log("\n📦 Building developer prompt based on analysis...");
    const devPromptText = buildDevPrompt(analysis);
    await fs.writeFile(`${urlSlug}_full_developer_prompt.txt`, devPromptText);

    console.log("\n🚀 Sending developer prompt to GPT...");
    const devPrompt = await callGPT(devPromptText);
    await fs.writeFile(`${urlSlug}_developer_prompt.txt`, devPrompt);

    console.log("\n✅ All done. Developer prompt saved.");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();