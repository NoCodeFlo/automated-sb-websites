import { fetchJson } from './http.js';

const DEFAULT_BASE_URL = process.env.V0_API_BASE || 'https://api.v0.dev/v1';

export async function getChat(chatId, baseUrl = DEFAULT_BASE_URL) {
  return fetchJson('GET', `/chats/${chatId}`, { baseUrl });
}

export async function waitForChatVersion(chatId, {
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 120_000,
  intervalMs = 1500,
} = {}) {
  const start = Date.now();
  let lastStatus = 'unknown';
  while (Date.now() - start < timeoutMs) {
    const detail = await getChat(chatId, baseUrl);
    const lv = detail?.latestVersion;
    if (lv?.id && lv?.status === 'completed') {
      return lv.id;
    }
    if (lv?.status === 'failed') {
      throw new Error(`Chat version failed for chat ${chatId}`);
    }
    lastStatus = lv?.status || 'missing';
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for chat ${chatId} version to complete (last status: ${lastStatus})`);
}

export async function createDeployment({ projectId, chatId, versionId }, baseUrl = DEFAULT_BASE_URL) {
  const res = await fetchJson('POST', '/deployments', {
    baseUrl,
    body: { projectId, chatId, versionId },
  });
  // Normalize result
  return {
    id: res?.id || res?.deployment?.id,
    webUrl: res?.webUrl || res?.deployment?.webUrl,
    inspectorUrl: res?.inspectorUrl || res?.deployment?.inspectorUrl,
  };
}

