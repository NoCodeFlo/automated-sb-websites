// src/utils/vercelClient.js
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const VERCEL_API_KEY = process.env.VERCEL_API_KEY;
const VERCEL_API_URL = "https://api.v0.dev/platform"; // Base URL for v0 API

if (!VERCEL_API_KEY) {
  console.error("❌ Missing VERCEL_API_KEY in .env");
  process.exit(1);
}

export async function createVercelProject(projectName) {
  const response = await fetch(`${VERCEL_API_URL}/projects`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VERCEL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: projectName })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`❌ Failed to create project: ${errText}`);
  }

  const json = await response.json();
  console.log(`✅ Project created: ${json.project.id}`);
  return json.project.id;
}

export async function createVercelChat(projectId, developerPromptPath) {
  try {
    const promptContent = await fs.readFile(developerPromptPath, "utf-8");

    const response = await fetch(`${VERCEL_API_URL}/chats`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VERCEL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId,
        message: promptContent
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`❌ Failed to create chat: ${errText}`);
    }

    const json = await response.json();
    console.log(`✅ Chat created: ${json.chat.id}`);
    return json.chat.id;

  } catch (err) {
    throw new Error(`❌ Chat creation error: ${err.message}`);
  }
}