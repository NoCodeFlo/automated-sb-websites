// src/utils/gptClient.js
import 'dotenv/config';
import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-5"; // Use GPT-5 as requested

if (!OPENAI_API_KEY) {
  console.error("❌ Missing OpenAI API key in .env file.");
  process.exit(1);
}

export async function callGPT(prompt) {
  try {
    console.log(`🧠 Sending prompt to model: ${MODEL}`);

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GPT API error: ${errText}`);
    }

    const data = await response.json();

    // ✅ Log actual model used by OpenAI API (could be aliased or fallback)
    if (data.model) {
      console.log(`📦 GPT API responded with model: ${data.model}`);
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error(`❌ GPT call failed: ${error.message}`);
    throw error;
  }
}