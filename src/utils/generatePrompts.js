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

function baseInitialTemplate() {
  return `
You are a professional web designer tasked with analyzing the structure and content of a real website. take a look at the follwoing website HTML code of the home page:

INSERT HTML CODE HERE

1. analyse it core structure: amount of pages/subpages, color scheme, menu, banner, images, contact info, etc. 
2. anaylse its content: name of compay, slogan, offered services, more detailed text/descriptions once done 
3. after the analysis, use your knowledge as a world class UX designer and Software developer to provide feedback what needs to be done to keep the identity of the page (colors, logo, content), while still introducing a more modern look and feel to the page. 
4. provide links to relevant existing images that can be reused in the modern page directly within the prompt so that they can be accessed
5. create a prompt that allows a web developer to build a more modern version of this website into a one-page site. you can shorten /alter text and also reduce the amount of subapges in order to achieve this.
6. the new page must not include hyperlinks to the old website.

You are an agent - please keep going until the user’s query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. If you are not sure about file content or codebase structure pertaining to the user’s request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer. You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully. 
Provide back only the full prompt with all details relevant to build the page. Structure the prompt in the following sections:
- Intro sentence ("e.g. Build a modern one-page website for ...")
- Project Overview
- Tech & Approach
- Color & Theming (preserve palette, make it more modern and make sure that contrast is sufficient)
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
}

function baseRefineTemplate() {
  return `
You previously produced a complete developer-ready prompt for rebuilding a website into a modern one-page site.

Below is your previous output (CURRENT PROMPT), followed by HTML of an additional important page of the same site (NEW PAGE HTML). Refine and update the CURRENT PROMPT to incorporate any missing content, structure, and semantics from the NEW PAGE HTML, while preserving identity and consolidating into a single-page design. Keep wording succinct, avoid duplication, and reduce unnecessary subpages by folding content into anchored sections. If conflicts arise, prefer homepage identity and unify tone.

Return ONLY the updated full prompt in the same section structure.

CURRENT PROMPT START
{{CURRENT_PROMPT}}
CURRENT PROMPT END

NEW PAGE HTML START
{{NEW_PAGE_HTML}}
NEW PAGE HTML END
`.trim();
}

export function buildAnalysisPrompt(htmlMap, rootUrl) {
  const homepageHtml = resolveHomepageHtml(htmlMap, rootUrl);
  const template = baseInitialTemplate();
  return template.replace('INSERT HTML CODE HERE', homepageHtml);
}

// ————— Link extraction and page selection —————
function extractHrefs(html) {
  if (!html) return [];
  // Simple href extraction; avoids full DOM dependency
  const hrefs = [];
  const regex = /href\s*=\s*"([^"]+)"|href\s*=\s*'([^']+)'/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const h = m[1] || m[2];
    if (h) hrefs.push(h);
  }
  return hrefs;
}

function absoluteInternal(url, rootUrl) {
  try {
    const abs = new URL(url, rootUrl).toString();
    const r = new URL(rootUrl);
    return abs.startsWith(`${r.protocol}//${r.host}`) ? abs : null;
  } catch {
    return null;
  }
}

function pathDepth(u) {
  try {
    const p = new URL(u).pathname.replace(/\/+$/, ''); // strip trailing slash
    if (p === '' || p === '/') return 0;
    return p.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

function findNavBlock(html) {
  if (!html) return '';
  // Try <nav> first
  const navMatch = html.match(/<nav[\s\S]*?<\/nav>/i);
  if (navMatch) return navMatch[0];
  // Fallback to header
  const headerMatch = html.match(/<header[\s\S]*?<\/header>/i);
  if (headerMatch) return headerMatch[0];
  // Fallback to common nav class names
  const menuMatch = html.match(/<[^>]*class=["'][^"']*(nav|menu|navbar)[^"']*["'][\s\S]*?<\/[^>]+>/i);
  return menuMatch ? menuMatch[0] : '';
}

function rankByKeywords(urls) {
  const keywords = [
    'about','ueber','über','uber','team','profil','wer','mich','company','unternehmen',
    'leistungen','services','angebot','workshop','kurse','kurse','programm','portfolio',
    'preise','pricing','kontakt','contact','impressum','datenschutz','blog','news'
  ];
  return urls.slice().sort((a, b) => {
    const as = keywords.reduce((acc, k) => acc + (a.toLowerCase().includes(k) ? 1 : 0), 0);
    const bs = keywords.reduce((acc, k) => acc + (b.toLowerCase().includes(k) ? 1 : 0), 0);
    if (as !== bs) return bs - as;
    // Secondary: shorter path depth first
    const depth = u => {
      try { return new URL(u).pathname.split('/').filter(Boolean).length; } catch { return 99; }
    };
    return depth(a) - depth(b);
  });
}

export function selectTopPages(htmlMap, rootUrl, maxCount = 5) {
  const homepageHtml = resolveHomepageHtml(htmlMap, rootUrl);

  const selected = [];
  const seen = new Set();

  // Always start with homepage
  const homepageVariants = variantsForHomepage(rootUrl);
  let homepageKey = null;
  for (const v of homepageVariants) { if (htmlMap[v]) { homepageKey = v; break; } }
  if (!homepageKey) throw new Error('Homepage key not found although HTML was resolved.');

  selected.push(homepageKey);
  seen.add(homepageKey);

  // Extract nav links from nav/header block
  const navBlock = findNavBlock(homepageHtml);
  const homepageHrefs = extractHrefs(navBlock);

  const navUrls = homepageHrefs
    .map(h => absoluteInternal(h, rootUrl))
    .filter(Boolean)
    // Only keep top-level paths (depth <= 1)
    .filter(u => pathDepth(u) <= 1);

  // Keep only those present in htmlMap
  for (const u of navUrls) {
    if (htmlMap[u] && !seen.has(u)) {
      selected.push(u);
      seen.add(u);
      if (selected.length >= maxCount) return selected;
    }
  }

  // Fallback: use other internal pages from htmlMap ranked by keywords and path depth
  const allInternal = Object.keys(htmlMap)
    .filter(u => {
      try {
        const abs = new URL(u);
        const root = new URL(rootUrl);
        return abs.host === root.host;
      } catch { return false; }
    })
    // Only keep top-level paths (depth <= 1)
    .filter(u => pathDepth(u) <= 1)
    .filter(u => !seen.has(u));

  for (const u of rankByKeywords(allInternal)) {
    selected.push(u);
    seen.add(u);
    if (selected.length >= maxCount) break;
  }

  return selected;
}

export function buildInitialPrompt(htmlMap, rootUrl) {
  const homepageHtml = resolveHomepageHtml(htmlMap, rootUrl);
  const prompt = baseInitialTemplate().replace('INSERT HTML CODE HERE', homepageHtml);
  return prompt.slice(0, GPT_CHAR_LIMIT);
}

export function buildRefinementPrompt(previousOutput, newPageHtml) {
  const tpl = baseRefineTemplate()
    .replace('{{CURRENT_PROMPT}}', previousOutput || '')
    .replace('{{NEW_PAGE_HTML}}', newPageHtml || '');
  return tpl.slice(0, GPT_CHAR_LIMIT);
}

export async function generatePrompts(htmlMap, rootUrl /*, siteOutputDir */) {
  // Multi-step flow: select up to N important pages (homepage first)
  const maxPagesEnv = parseInt(process.env.ANALYSIS_MAX_PAGES || '5', 10);
  const maxPages = Number.isFinite(maxPagesEnv) && maxPagesEnv > 0 ? Math.min(maxPagesEnv, 10) : 5;
  const pages = selectTopPages(htmlMap, rootUrl, maxPages);
  const homepageKey = pages[0];
  const analysisPrompt = buildInitialPrompt(htmlMap, rootUrl);

  // For subsequent pages (if any), prepare their HTML for refinement steps
  const refinementPages = pages.slice(1).map(u => ({ url: u, html: htmlMap[u] }));

  return { analysisPrompt, refinementPages };
}
