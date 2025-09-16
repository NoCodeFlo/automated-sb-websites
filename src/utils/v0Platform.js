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
    // Avoid duplicate network attempts; treat first response as source of truth
    retry: { attempts: 1, baseMs: 300 },
  });
  // Normalize result
  const dep = {
    id: res?.id || res?.deployment?.id,
    webUrl: res?.webUrl || res?.deployment?.webUrl,
    inspectorUrl: res?.inspectorUrl || res?.deployment?.inspectorUrl,
  };

  // If v0 accepted the request but later reports errors, surface them
  // Try to fetch errors a few times shortly after creation.
  try {
    if (!dep.id) {
      throw new Error('Deployment response missing id.');
    }
    const err = await waitForDeploymentErrors(dep.id, { baseUrl, timeoutMs: 30_000, intervalMs: 1500 });
    if (err) {
      const msg = typeof err === 'string' ? err : JSON.stringify(err).slice(0, 500);
      const e = new Error(`v0 deployment reported errors: ${msg}`);
      e.deploymentId = dep.id;
      throw e;
    }
  } catch (e) {
    // If we detect errors, rethrow to caller; otherwise ignore transient issues
    if (e && /deployment reported errors|missing id/i.test(e.message || '')) {
      throw e;
    }
  }

  return dep;
}

async function getDeploymentErrors(deploymentId, baseUrl = DEFAULT_BASE_URL) {
  const res = await fetchJson('GET', `/deployments/${deploymentId}/errors`, {
    baseUrl,
    retry: { attempts: 3, baseMs: 300 },
  });
  return res;
}

export async function waitForDeploymentErrors(deploymentId, {
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 30_000,
  intervalMs = 1500,
} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await getDeploymentErrors(deploymentId, baseUrl);
    const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    if (arr.length > 0) {
      return arr[0];
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}
