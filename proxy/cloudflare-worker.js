// Deploy this file separately as a Cloudflare Worker.
const APP_VERSION = 'v27';
const ALLOWED_ORIGIN = 'https://11906257.github.io';
const UPSTREAM_URL = 'https://www.wienerlinien.at/ogd_realtime/monitor';
const ALLOWED_STOP_IDS = new Set(['754', '1699', '1687', '1698']);
const MAX_STOP_IDS = 4;
const MAX_QUERY_FIELDS = MAX_STOP_IDS * 2;
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_ACCESS_KEY_LENGTH = 256;
const TEXT_ENCODER = new TextEncoder();

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Authorization',
  'Access-Control-Max-Age': '86400',
  'X-App-Version': APP_VERSION,
  'Vary': 'Origin'
});
const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
});

function validAccessKey(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ACCESS_KEY_LENGTH
    && /^[!-~]+$/u.test(value);
}

function bearerToken(request) {
  const match = request.headers.get('Authorization')?.match(/^Bearer (.+)$/u);
  const token = match?.[1] ?? '';
  return validAccessKey(token) ? token : '';
}

async function keysMatch(providedKey, configuredKey) {
  if (!validAccessKey(providedKey) || !validAccessKey(configuredKey)) return false;
  const [providedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(providedKey)),
    crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(configuredKey))
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(configuredHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function textResponse(message, status, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      ...extraHeaders
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin !== ALLOWED_ORIGIN) return textResponse('Forbidden', 403);

    const incomingUrl = new URL(request.url);
    if (incomingUrl.pathname !== '/monitor') return textResponse('Not Found', 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return textResponse('Method Not Allowed', 405, { Allow:'GET, OPTIONS' });
    if (!validAccessKey(env.ACCESS_KEY)) return textResponse('Access key is not configured', 503);
    if (!await keysMatch(bearerToken(request), env.ACCESS_KEY)) {
      return textResponse('Unauthorized', 401, { 'WWW-Authenticate':'Bearer' });
    }

    const parameterNames = [...incomingUrl.searchParams.keys()];
    const stopIds = [...new Set(incomingUrl.searchParams.getAll('stopId'))];
    if (
      parameterNames.length > MAX_QUERY_FIELDS
      || parameterNames.some(name => name !== 'stopId')
      || !stopIds.length
      || stopIds.length > MAX_STOP_IDS
      || stopIds.some(stopId => !ALLOWED_STOP_IDS.has(stopId))
    ) {
      return textResponse('Invalid stopId', 400);
    }

    const upstreamUrl = new URL(UPSTREAM_URL);
    stopIds.forEach(stopId => upstreamUrl.searchParams.append('stopId', stopId));

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        redirect: 'error'
      });
      if (!upstreamResponse.ok) return textResponse('Upstream API error', 502);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          ...CORS_HEADERS,
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json; charset=utf-8'
        }
      });
    } catch {
      return textResponse('Upstream API unavailable', 502);
    }
  }
};
