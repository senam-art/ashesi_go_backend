const { randomBytes } = require('crypto');
const {
  VERBOSE_HTTP,
  ts,
  sanitize,
  sanitizeHeaders,
  stringifyForLog,
} = require('../utils/verboseLog');

/**
 * Logs every incoming HTTP request and outgoing response (status + body).
 * Assigns req.reqId for correlating logs across services.
 *
 * Note: mobile "button taps" are not visible here — only network calls that
 * reach this Express server are logged.
 */
function verboseHttpLogger(req, res, next) {
  if (!VERBOSE_HTTP) {
    req.reqId = randomBytes(4).toString('hex');
    return next();
  }

  req.reqId = randomBytes(4).toString('hex');
  const started = Date.now();
  let responseBody;

  console.log('\n' + '='.repeat(88));
  console.log(`[${ts()}] [IN  ${req.reqId}] ${req.method} ${req.originalUrl}`);
  console.log(`[${ts()}] [IN  ${req.reqId}] IP: ${req.ip || req.socket?.remoteAddress || 'n/a'}`);
  console.log(`[${ts()}] [IN  ${req.reqId}] params:`, stringifyForLog(sanitize(req.params)));
  console.log(`[${ts()}] [IN  ${req.reqId}] query:`, stringifyForLog(sanitize(req.query)));
  console.log(`[${ts()}] [IN  ${req.reqId}] headers:`, stringifyForLog(sanitizeHeaders(req.headers)));
  const body = req.body;
  if (body !== undefined && body !== null && typeof body === 'object' && Object.keys(body).length > 0) {
    console.log(`[${ts()}] [IN  ${req.reqId}] body:`, stringifyForLog(sanitize(body)));
  } else if (typeof body === 'string' && body.length > 0) {
    console.log(`[${ts()}] [IN  ${req.reqId}] body(raw):`, stringifyForLog(sanitize({ raw: body })));
  }

  const origJson = res.json.bind(res);
  res.json = function jsonLogged(body) {
    responseBody = body;
    return origJson(body);
  };

  const origSend = res.send.bind(res);
  res.send = function sendLogged(body) {
    if (responseBody === undefined) responseBody = body;
    return origSend(body);
  };

  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(`[${ts()}] [OUT ${req.reqId}] ${res.statusCode} ${ms}ms`);
    if (responseBody !== undefined) {
      let toLog = responseBody;
      if (Buffer.isBuffer(toLog)) {
        toLog = { rawBufferBytes: toLog.length };
      } else if (typeof toLog === 'string') {
        toLog = { raw: toLog };
      }
      console.log(`[${ts()}] [OUT ${req.reqId}] body:`, stringifyForLog(sanitize(toLog)));
    }
    console.log('='.repeat(88) + '\n');
  });

  next();
}

module.exports = { verboseHttpLogger };
