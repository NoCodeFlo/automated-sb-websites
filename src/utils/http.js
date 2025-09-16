import 'dotenv/config';
import fetch from 'node-fetch';

const DEFAULT_BASE_URL = process.env.V0_API_BASE || 'https://api.v0.dev/v1';

function getApiKey() {
  return process.env.V0_API_KEY || process.env.VERCEL_API_KEY || '';
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// fetchJson(method, url, { body, headers, baseUrl })
export async function fetchJson(method, url, opts = {}) {
  const {
    body,
    headers = {},
    baseUrl = DEFAULT_BASE_URL,
    retry = { attempts: 3, baseMs: 300 },
    idempotencyKey,
    auth = true,
  } = opts;

  const apiKey = auth ? getApiKey() : null;
  if (auth && !apiKey) {
    throw new Error('Missing API key: set V0_API_KEY or VERCEL_API_KEY');
  }

  const finalUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const authHeaders = {
    ...(auth && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  };
  if (idempotencyKey) {
    authHeaders['Idempotency-Key'] = String(idempotencyKey);
  }

  const maxAttempts = Math.max(1, retry?.attempts ?? 3);
  const baseMs = Math.max(50, retry?.baseMs ?? 300);

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(finalUrl, {
        method,
        headers: authHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const status = res.status;
        const text = await res.text().catch(() => '');
        const snippet = text?.slice(0, 500);

        // Retry on 429 and 5xx
        if (status === 429 || (status >= 500 && status <= 599)) {
          if (attempt < maxAttempts) {
            const delay = baseMs * Math.pow(2, attempt - 1);
            await sleep(delay);
            continue;
          }
        }

        const err = new Error(`HTTP ${status} ${res.statusText} — ${snippet}`);
        err.status = status;
        err.body = snippet;
        throw err;
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await res.json();
      }
      // Fallback: return raw text
      return await res.text();
    } catch (err) {
      lastErr = err;
      // Only retry network/HTTP retriable errors; others break immediately
      const status = err?.status;
      if (status && status !== 429 && (status < 500 || status > 599)) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = baseMs * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Unknown fetch error');
}

export const http = { fetchJson };
