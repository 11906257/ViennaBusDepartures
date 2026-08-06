// Deploy this file separately as a Cloudflare Worker.
const APP_VERSION = 'v21';
const ALLOWED_ORIGIN = 'https://11906257.github.io';
const UPSTREAM_URL = 'https://www.wienerlinien.at/ogd_realtime/monitor';
const ALLOWED_STOP_IDS = new Set(['754', '770', '1687', '1698']);
const MAX_STOP_IDS = 4;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Authorization',
  'Access-Control-Max-Age': '86400',
  'X-App-Version': APP_VERSION,
  'Vary': 'Origin'
};

function bearerToken(request) {
  const match = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? '';
}

async function keysMatch(providedKey, configuredKey) {
  if (!providedKey || !configuredKey) return false;
  const encoder = new TextEncoder();
  const [providedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(providedKey)),
    crypto.subtle.digest('SHA-256', encoder.encode(configuredKey))
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(configuredHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function textResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
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
    if (request.method !== 'GET') return textResponse('Method Not Allowed', 405);
    if (!env.ACCESS_KEY) return textResponse('Access key is not configured', 503);
    if (!await keysMatch(bearerToken(request), env.ACCESS_KEY)) return textResponse('Unauthorized', 401);

    const stopIds = [...new Set(incomingUrl.searchParams.getAll('stopId'))];
    if (
      !stopIds.length
      || stopIds.length > MAX_STOP_IDS
      || stopIds.some(stopId => !ALLOWED_STOP_IDS.has(stopId))
    ) {
      return textResponse('Invalid stopId', 400);
    }

    const upstreamUrl = new URL(UPSTREAM_URL);
    stopIds.forEach(stopId => upstreamUrl.searchParams.append('stopId', stopId));

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        headers: { Accept: 'application/json' }
      });
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch {
      return textResponse('Upstream API unavailable', 502);
    }
  }
};
