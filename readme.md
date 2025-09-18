# 🌐 Website Analyzer API

This project provides an end-to-end pipeline for analyzing and redesigning websites using Puppeteer and GPT-5. Given a URL, it:

1. Scrapes HTML and screenshots (depth-limited crawling)
2. Generates iterative GPT prompts (homepage first, then refine with up to four additional important pages)
3. Calls OpenAI’s GPT-5 API per iteration and consolidates the final, improved prompt
4. Optionally creates a v0 (Vercel) project, chat, and deployment (returns public URL)
5. Saves all outputs in a structured local folder

Note: The scraper sanitizes HTML upfront (removing scripts, styles, templates, comments, noisy attributes, and other non-content elements while preserving the <title> and core body content). All downstream prompts use this cleaned HTML directly; there is no additional cleaning step.

---

## 🏗 Folder Structure
project-root/
├── output/
│   └── /
│       ├── page-*.html/.txt/.png
│       ├── _site_analysis.txt
│       └── _developer_prompt.txt
├── src/
│   ├── api/
│   │   └── runAnalysis.js
│   ├── clients/
│   │   ├── gptClient.js
│   │   └── vercelClient.js
│   ├── routes/
│   │   └── analyzeRoute.js
│   ├── services/
│   │   ├── scrapeSite.js
│   │   └── generatePrompts.js
│   └── utils/
│       └── slugifyUrl.js
├── .env
├── app.js
└── README.md

---

## 🚀 How to Use

### 1. Install dependencies

```bash
npm install

2. Set environment variables

Create a .env file at the root:

OPENAI_API_KEY=your_openai_key
VERCEL_API_KEY=your_vercel_platform_api_key

3. Start the server
node app.js

4. Call the API
Send a POST request to /analyze with a JSON body:
json
{
  "url": "https://example.com"
}

Example using curl:
bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://lichtweg.li/"}'

  💡 Outputs

For each analyzed website, the following files are saved under output/<domain-slug>/:
	•	page-*.html: Raw HTML of each visited page
	•	page-*.txt: Same content in plain text
	•	page-*.png: Full-page screenshots
	•	<slug>_site_analysis.txt: Final refined developer-ready prompt (aims for 5 iterations)
	•	<slug>_full_analysis_prompt.txt: Final input prompt sent to GPT that produced the output
	•	iterations/: Per-step prompts and responses for traceability

When `VERCEL_API_KEY` (or `V0_API_KEY`) is set and `SKIP_V0` is not set, the API also creates a v0 project + chat, waits for the initial chat version, deploys it, and returns deployment info in the response JSON under `deployment.webUrl`.

Optional:
- Set `VERCEL_ALIAS` (or `V0_ALIAS`) to a domain/subdomain to attempt assigning an alias to the final deployment (uses Vercel API `POST /v2/aliases`). If the alias requires adding the domain to the project first, the API will attempt to add it and retry.

⸻

## ⚡ CLI: Create v0 Project → Chat → Deployment

This repo includes a CLI to create a v0 project, start a chat, and immediately create a deployment from that chat version. It prints a final JSON result (minified by default, pretty with `--json`) to STDOUT. On failure, it prints a concise error to STDERR and exits with code 1.

Prerequisites:

- Set `V0_API_KEY` (preferred) or `VERCEL_API_KEY` in your `.env` or environment.

Usage:

```
npx v0-create-deploy --name "My Project" --message "Build a landing page for ..."
```

Or read the message from a file:

```
npx v0-create-deploy --name "My Project" --message-file output/<slug>/<slug>_site_analysis.txt
```

Flags:

- `--name, -n`: Project name (required)
- `--message, -m`: Initial chat message text
- `--message-file, -f`: Path to file with the message
- `--json`: Pretty-print JSON output
- `--base-url`: Override API base (defaults to `https://api.v0.dev/v1`)

Outputs JSON with:

```
{
  "projectId": "prj_...",
  "chatId": "chat_...",
  "versionId": "ver_...",
  "deploymentId": "dep_...",
  "publicUrl": "https://...",
  "inspectorUrl": "https://..."
}
```

Notes:

- The CLI validates required flags, calls the three v0 endpoints in order, and exits with 0 on success.
- Retries with exponential backoff are built-in for `429` and `5xx` responses.
- The helper auto-injects the `Authorization` header from `V0_API_KEY` (or `VERCEL_API_KEY`).

🔧 Customization

You can adapt the pipeline in these places:
	•	scrapeSite.js: for crawler depth, filtering, or screenshot logic
	•	generatePrompts.js: multi-step selection and prompt formats
	•	gptClient.js: to switch model, temperature, or other settings
	•	vercelClient.js: for creating Vercel projects/chats via API
	•	http.js: lightweight HTTP helper with retries and auth

⸻

🛠 Built With
	•	Node.js + Express
	•	Puppeteer
	•	OpenAI GPT-5 API
	•	Vercel Platform API
