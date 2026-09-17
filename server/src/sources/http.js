import config from '../config.js';
import { run } from '../db/index.js';

export class SourceError extends Error {
  constructor(message, { status = null, url = null, cause = null } = {}) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logFetch({ source, url, ok, status, error, durationMs, bytes }) {
  try {
    run(
      `INSERT INTO fetch_log(source, url, ok, status, error, duration_ms, bytes, fetched_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      source, url, ok ? 1 : 0, status ?? null, error ?? null,
      Math.round(durationMs), bytes ?? null, new Date().toISOString(),
    );
  } catch {
    // Logging must never be the reason a fetch fails.
  }
}

/**
 * GET JSON with timeout, bounded retries and exponential backoff.
 * 4xx other than 429 are not retried — they will not fix themselves.
 */
export async function getJson(url, { source = 'http', timeoutMs = 20000, retries = config.http.retries, headers = {} } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'dynasty-helper/1.0', ...headers },
      });
      const text = await res.text();
      const duration = Date.now() - started;

      if (!res.ok) {
        const err = new SourceError(`HTTP ${res.status} from ${url}`, { status: res.status, url });
        logFetch({ source, url, ok: false, status: res.status, error: err.message, durationMs: duration, bytes: text.length });
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === retries) throw err;
        lastErr = err;
      } else {
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          const err = new SourceError(`Malformed JSON from ${url}: ${parseErr.message}`, { status: res.status, url, cause: parseErr });
          logFetch({ source, url, ok: false, status: res.status, error: err.message, durationMs: duration, bytes: text.length });
          throw err;
        }
        logFetch({ source, url, ok: true, status: res.status, error: null, durationMs: duration, bytes: text.length });
        return data;
      }
    } catch (err) {
      const duration = Date.now() - started;
      if (err instanceof SourceError) {
        if (attempt === retries) throw err;
        lastErr = err;
      } else {
        const wrapped = err.name === 'AbortError'
          ? new SourceError(`Timed out after ${timeoutMs}ms: ${url}`, { url, cause: err })
          : new SourceError(`Network error for ${url}: ${err.message}`, { url, cause: err });
        logFetch({ source, url, ok: false, status: null, error: wrapped.message, durationMs: duration });
        if (attempt === retries) throw wrapped;
        lastErr = wrapped;
      }
    } finally {
      clearTimeout(timer);
    }

    await sleep(config.http.backoffMs * 2 ** attempt);
  }

  throw lastErr ?? new SourceError(`Failed to fetch ${url}`, { url });
}

export function buildUrl(base, path, params = {}) {
  const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}
