// Utilities to build prompts for analysis and developer tasks.
// This module deliberately does not call GPT or write files.
// Callers should use src/utils/gptClient.js for model calls and
// handle any persistence in their own layer.

const GPT_CHAR_LIMIT = 120000 * 3; // Soft cap to keep prompts manageable

function normalizeUrl(u) {
  try {
    const url = new URL((u || '').trim());
    url.hash = '';
    url.search = '';
    if (!url.pathname || url.pathname === '') url.pathname = '/';
    return url;
  } catch {
    return null;
  }
}

function variantsForHomepage(u) {
  const url = normalizeUrl(u);
  if (!url) return [];

  const variants = new Set();

  const hosts = new Set([url.host]);
  // Toggle www
  if (url.hostname.startsWith('www.')) {
    hosts.add(url.host.replace('www.', ''));
    } else {
    hosts.add(url.host.replace(url.hostname, `www.${url.hostname}`));
  }

  const schemes = new Set([url.protocol.replace(':', ''), url.protocol === 'https:' ? 'http' : 'https']);
  const paths = new Set(['/','/index','/index.html','/index.htm','/index.php','/default.aspx']);

  for (const scheme of schemes) {
    for (const host of hosts) {
      for (const path of paths) {
        const v = `${scheme}://${host}${path}`;
        variants.add(v);
        // Also add with trailing slash if not already
        if (!v.endsWith('/')) variants.add(`${v}/`);
      }
    }
  }

  // Also include exact given URL and its trailing-slash variants
  const exact = url.toString();
  variants.add(exact);
  if (exact.endsWith('/')) variants.add(exact.slice(0, -1));
  else variants.add(`${exact}/`);

  return Array.from(variants);
}

function resolveHomepageHtml(htmlMap, rootUrl) {
  // 1) Try exact and common homepage variants for the provided URL
  const candidates = variantsForHomepage(rootUrl);
  for (const key of candidates) {
    if (htmlMap[key]) return htmlMap[key];
  }

  // 2) Try to locate a homepage-like entry among scraped URLs sharing the same registrable host
  const base = normalizeUrl(rootUrl);
  if (base) {
    const baseHost = base.hostname.replace(/^www\./, '');
    const homePaths = new Set(['/','/index','/index.html','/index.htm','/index.php','/default.aspx']);
    for (const [key, html] of Object.entries(htmlMap)) {
      try {
        const k = new URL(key);
        const kHost = k.hostname.replace(/^www\./, '');
        let p = k.pathname || '/';
        // Normalize trailing slash
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        if (kHost === baseHost && homePaths.has(p)) {
          return html;
    }
      } catch {/* ignore invalid URLs in map */}
    }
  }

  // 3) Fail fast: do not use another page, ensure strict homepage usage
  throw new Error('Homepage HTML not found in scraped results.');
}

export function buildAnalysisPrompt(htmlMap, rootUrl) {
  // Strictly resolve the homepage HTML; do not fall back to other pages
  const homepageHtml = resolveHomepageHtml(htmlMap, rootUrl);

  const template = `
You are a professional web designer tasked with analyzing the structure and content of a real website. take a look at the follwoing website HTML code of the home page:

INSERT HTML CODE HERE

1. analyse it core structure: amount of pages/subpages, color scheme, menu, banner, images, contact info, etc. 
2. anaylse its content: name of compay, slogan, offered services, more detailed text/descriptions once done 
3. after the analysis, use your knowledge as a world class UX designer and Software developer to provide feedback what needs to be done to keep the identity of the page (colors, logo, content), while still introducing a more modern look and feel to the page. 
4. provide links to relevant existing images that can be reused in the modern page directly within the prompt so that they can be accessed
5. create a prompt that allows a web developer to build a more modern version of this website into a one-page site. you can shorten /alter text and also reduce the amount of subapges in order to achieve this. 

You are an agent - please keep going until the user’s query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. If you are not sure about file content or codebase structure pertaining to the user’s request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer. You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully. 
Provide back only the full prompt with all details relevant to build the page. Structure the prompt in the following sections:
- Intro sentence ("e.g. Build a modern one-page website for ...")
- Project Overview
- Tech & Approach
- Color & Theming (preserve palette)
- Layout (one-page with anchor nav)
- Copy (final German strings)
- Navigation labels (anchors)
- Components & Interactions
- Assets
- Metadata & SEO
- Example JSON-LD (adapt with real data)
- Tailwind utility hints
- Accessibility specifics
- Content details for service card
- Routing/Anchors (one-page)
- QA checklist (developer)
- Deliverables

`.trim();

  // Insert homepage HTML at the placeholder position
  return template.replace('INSERT HTML CODE HERE', homepageHtml);
}

export async function generatePrompts(htmlMap, rootUrl /*, siteOutputDir */) {
  // Build the single prompt (v0-ready) using HOMEPAGE HTML only.
  const analysisPrompt = buildAnalysisPrompt(htmlMap, rootUrl).slice(0, GPT_CHAR_LIMIT);

  // Single-pass mode: only one prompt is produced and sent to GPT.
  return { analysisPrompt };
}
