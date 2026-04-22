const { sanitize, sanitizeHeaders, logHttp } = require('./verboseLog');

/**
 * httpJson(url, opts)
 *
 * Tiny wrapper around the built-in fetch (Node 18+). Always sends/receives
 * JSON, applies a hard timeout via AbortController, and throws on non-2xx
 * with a structured error (`err.status`, `err.body`).
 */
async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  logHttp('OUTBOUND_REQUEST', {
    method,
    url,
    timeoutMs,
    headers: sanitizeHeaders(headers),
    body: body != null ? sanitize(body) : null,
  });

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const json = text ? safeJsonParse(text) : null;

    logHttp('OUTBOUND_RESPONSE', {
      url,
      status: res.status,
      ok: res.ok,
      body: sanitize(json),
    });

    if (!res.ok) {
      const err = new Error((json && json.message) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }

    return json;
  } catch (err) {
    logHttp('OUTBOUND_ERROR', {
      url,
      message: err.message,
      status: err.status,
      body: err.body != null ? sanitize(err.body) : undefined,
    });
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

module.exports = { httpJson };
