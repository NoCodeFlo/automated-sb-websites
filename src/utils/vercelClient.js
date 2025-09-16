// src/utils/vercelClient.js
import 'dotenv/config';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fetchJson } from './http.js';

const BASE_URL = process.env.V0_API_BASE || 'https://api.v0.dev/v1';

export async function createVercelProject(projectName) {
  const idem = crypto.createHash('sha256').update(`project:${projectName}`).digest('hex');
  const res = await fetchJson('POST', '/projects', {
    baseUrl: BASE_URL,
    body: { name: projectName },
    idempotencyKey: idem,
    // Ensure only one network attempt (no retries) to avoid duplicate billing
    retry: { attempts: 1, baseMs: 300 },
  });
  const id = res?.id || res?.project?.id;
  if (!id) throw new Error('❌ Failed to create project: missing id');
  console.log(`✅ Project created: ${id}`);
  return id;
}

export async function createVercelChat(projectId, developerPromptPath) {
  try {
    const message = await fs.readFile(developerPromptPath, 'utf-8');
    const idem = crypto.createHash('sha256').update(`chat:${projectId}:${message}`).digest('hex');
    const res = await fetchJson('POST', '/chats', {
      baseUrl: BASE_URL,
      body: { projectId, message },
      idempotencyKey: idem,
      // Ensure only one network attempt (no retries) to avoid duplicate billing
      retry: { attempts: 1, baseMs: 300 },
    });
    const id = res?.id || res?.chat?.id;
    if (!id) throw new Error('❌ Failed to create chat: missing id');
    console.log(`✅ Chat created: ${id}`);
    return id;
  } catch (err) {
    throw new Error(`❌ Chat creation error: ${err.message}`);
  }
}
