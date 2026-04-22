/**
 * Verbose debug logging for local development and deep tracing.
 * Set VERBOSE_HTTP_LOG=false to silence HTTP request/response dumps (default: on).
 */

const VERBOSE_HTTP = process.env.VERBOSE_HTTP_LOG !== 'false';
const MAX_STRING = 8000;
const MAX_ARRAY_ITEMS = 80;

const SENSITIVE_KEY = /^(password|passwd|pwd|secret|token|access_token|refresh_token|authorization_code|apikey|api_key|client_secret|credit_card|cvv|pin)$/i;
const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-api-key|x-goog-api-key)$/i;

function ts() {
  return new Date().toISOString();
}

function truncate(str, max = MAX_STRING) {
  if (str == null) return str;
  const s = typeof str === 'string' ? str : String(str);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated ${s.length - max} chars]`;
}

function sanitizeValue(key, value) {
  if (value == null) return value;
  if (typeof key === 'string' && SENSITIVE_KEY.test(key)) {
    if (typeof value === 'string') return `[REDACTED len=${value.length}]`;
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    const k = typeof key === 'string' ? key.toLowerCase() : '';
    if (k.includes('polyline') || k.includes('encoded_polyline')) {
      return value.length > 120 ? `[polyline ${value.length} chars]` : value;
    }
  }
  return value;
}

function sanitize(input, depth = 0) {
  if (depth > 10) return '[max depth]';
  if (input == null) return input;
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    const slice = input.slice(0, MAX_ARRAY_ITEMS).map((v, i) => sanitize(v, depth + 1));
    if (input.length > MAX_ARRAY_ITEMS) {
      slice.push(`…[${input.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return slice;
  }
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const sv = sanitizeValue(k, v);
    if (sv !== v) {
      out[k] = sv;
    } else if (v != null && typeof v === 'object') {
      out[k] = sanitize(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER.test(k)) {
      const len = typeof v === 'string' ? v.length : 0;
      out[k] = `[REDACTED len=${len}]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function stringifyForLog(value) {
  try {
    return truncate(JSON.stringify(value, null, 0));
  } catch (e) {
    return `[stringify error: ${e.message}]`;
  }
}

function logHttp(tag, payload) {
  if (!VERBOSE_HTTP) return;
  console.log(`[${ts()}] [httpJson] ${tag}`, stringifyForLog(sanitize(payload)));
}

function logLine(prefix, message, data) {
  if (data !== undefined) {
    console.log(`[${ts()}] [${prefix}] ${message}`, typeof data === 'string' ? data : stringifyForLog(sanitize(data)));
  } else {
    console.log(`[${ts()}] [${prefix}] ${message}`);
  }
}

module.exports = {
  VERBOSE_HTTP,
  ts,
  truncate,
  sanitize,
  sanitizeHeaders,
  stringifyForLog,
  logHttp,
  logLine,
};
