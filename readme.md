# 🌐 Website Analyzer API

This project provides an end-to-end pipeline for analyzing and redesigning websites using Puppeteer and GPT-5. Given a URL, it:

1. Scrapes HTML and screenshots (depth-limited crawling)
2. Generates GPT prompts (analysis + dev prompt)
3. Calls OpenAI’s GPT-5 API
4. Optionally creates a Vercel design project & chat
5. Saves all outputs in a structured local folder

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
	•	<slug>_site_analysis.txt: GPT-5 generated website analysis
	•	<slug>_developer_prompt.txt: GPT-5 prompt for a frontend developer

⸻

🔧 Customization

You can adapt the pipeline in these places:
	•	scrapeSite.js: for crawler depth, filtering, or screenshot logic
	•	generatePrompts.js: for analysis and developer prompt formats
	•	gptClient.js: to switch model, temperature, or other settings
	•	vercelClient.js: for creating Vercel projects/chats via API

⸻

🛠 Built With
	•	Node.js + Express
	•	Puppeteer
	•	OpenAI GPT-5 API
	•	Vercel Platform API