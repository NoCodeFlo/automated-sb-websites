// Utilities to build prompts for analysis and developer tasks.
// This module deliberately does not call GPT or write files.
// Callers should use src/utils/gptClient.js for model calls and
// handle any persistence in their own layer.

const GPT_CHAR_LIMIT = 120000 * 3; // Soft cap to keep prompts manageable

export function buildAnalysisPrompt(htmlMap) {
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

export function buildDevPrompt(analysisText) {
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
- If there are any pages linking to social media (Instagram, Facebook), include the existing external link on the website, but don't try to rebuild any of the social media pages

Make sure your developer prompt includes:
1. The URL of the website that will be rebuilt
2. An overview of the project and goals
3. A section-by-section breakdown of what the developer should implement for each page
4. When mentioning images, provide the direct URL to the hosted image if possible (only if it exists)
5. Specific frontend technologies or frameworks to consider (optional)
6. Any constraints or important content that must not be changed
7. Tone and feel of the new design (e.g., modern, clean, warm, etc.)
8. Deliverables: focus on the design and implementation of the page and do not specifically mention any plugins, configurations or creation of README documentation

---

Below is the original website analysis:

${analysisText}
`.trim();
}

export async function generatePrompts(htmlMap /*, urlSlug, siteOutputDir */) {
  // Build prompts only; do not call GPT or write files here.
  const analysisPrompt = buildAnalysisPrompt(htmlMap).slice(0, GPT_CHAR_LIMIT);

  // The developer prompt should be built by the caller using buildDevPrompt()
  // after obtaining analysis text from GPT.
  return { analysisPrompt };
}

