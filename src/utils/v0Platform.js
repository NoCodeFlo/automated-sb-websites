import { fetchJson } from './http.js';

const DEFAULT_BASE_URL = process.env.V0_API_BASE || 'https://api.v0.dev/v1';
const VERCEL_API_BASE = 'https://api.vercel.com';

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
    status: res?.status || res?.deployment?.status || 'unknown',
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

// Fetch a single deployment (normalized)
export async function getDeployment(deploymentId, baseUrl = DEFAULT_BASE_URL) {
  const res = await fetchJson('GET', `/deployments/${deploymentId}`, { baseUrl });
  const d = res?.deployment || res || {};
  return {
    id: d.id || deploymentId,
    status: d.status || 'unknown',
    webUrl: d.webUrl || d.url || d.web_url || null,
    inspectorUrl: d.inspectorUrl || d.inspector_url || null,
  };
}

// Wait for a deployment to become completed (or fail)
export async function waitForDeploymentReady(deploymentId, {
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 180_000,
  intervalMs = 2000,
} = {}) {
  const start = Date.now();
  let last = { status: 'unknown' };
  while (Date.now() - start < timeoutMs) {
    last = await getDeployment(deploymentId, baseUrl);
    const s = (last.status || '').toLowerCase();
    if (s === 'completed' || s === 'ready' || s === 'succeeded' || s === 'success') {
      return last;
    }
    if (s === 'failed' || s === 'error') {
      const err = await waitForDeploymentErrors(deploymentId, { baseUrl, timeoutMs: 1_000, intervalMs: 250 });
      const msg = err ? (typeof err === 'string' ? err : JSON.stringify(err).slice(0, 500)) : 'Deployment failed';
      const e = new Error(msg);
      e.deployment = last;
      throw e;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for deployment ${deploymentId} to be ready (last status: ${last.status})`);
}

// Optional: assign an alias (domain) to a deployment via Vercel API
export async function assignAlias({ deploymentId, alias, baseUrl = VERCEL_API_BASE }) {
  if (!deploymentId || !alias) {
    throw new Error('assignAlias requires deploymentId and alias');
  }
  const res = await fetchJson('POST', '/v2/aliases', {
    baseUrl,
    body: { deploymentId, alias },
    retry: { attempts: 1, baseMs: 200 },
  });
  return res;
}

// Optional: add a domain to a project (best-effort; may not be needed for vercel.app subdomains)
export async function addProjectDomain({ projectId, domain, baseUrl = VERCEL_API_BASE }) {
  if (!projectId || !domain) {
    throw new Error('addProjectDomain requires projectId and domain');
  }
  // Try v10 endpoint; fall back to v9 if needed
  try {
    return await fetchJson('POST', `/v10/projects/${projectId}/domains`, {
      baseUrl,
      body: { name: domain },
      retry: { attempts: 1, baseMs: 200 },
    });
  } catch (e) {
    return await fetchJson('POST', `/v9/projects/${projectId}/domains`, {
      baseUrl,
      body: { name: domain },
      retry: { attempts: 1, baseMs: 200 },
    });
  }
}
