import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = readFileSync(new URL('../proxy/cloudflare-worker.js', import.meta.url), 'utf8');

function loadWorker(upstreamFetch = async () => new Response('{"message":{"messageCode":1}}', {
  status:200,
  headers:{ 'Content-Type':'application/json' }
})) {
  const context = vm.createContext({
    AbortSignal,
    Headers,
    Object,
    Promise,
    Request,
    Response,
    Set,
    TextEncoder,
    URL,
    Uint8Array,
    crypto:webcrypto,
    fetch:upstreamFetch
  });
  vm.runInContext(workerSource.replace('export default {', 'globalThis.__worker = {'), context);
  return context.__worker;
}

const origin = 'https://11906257.github.io';
const secret = 'abc-12345';

function request(path = '/monitor?stopId=1687', options = {}) {
  return new Request(`https://worker.example${path}`, {
    method:options.method ?? 'GET',
    headers:{
      Origin:options.origin ?? origin,
      ...(options.key === null ? {} : { Authorization:`Bearer ${options.key ?? secret}` })
    }
  });
}

test('worker enforces origin, method and configured secret', async () => {
  const worker = loadWorker();
  assert.equal((await worker.fetch(request('/monitor?stopId=1687', { origin:'https://example.com' }), { ACCESS_KEY:secret })).status, 403);
  assert.equal((await worker.fetch(request('/monitor?stopId=1687', { method:'POST' }), { ACCESS_KEY:secret })).status, 405);
  assert.equal((await worker.fetch(request(), {})).status, 503);
  const unauthorized = await worker.fetch(request('/monitor?stopId=1687', { key:'wrong-key' }), { ACCESS_KEY:secret });
  assert.equal(unauthorized.status, 401);
});

test('worker handles CORS preflight without contacting upstream', async () => {
  let fetchCount = 0;
  const worker = loadWorker(async () => { fetchCount += 1; return new Response(); });
  const response = await worker.fetch(request('/monitor', { method:'OPTIONS', key:null }), { ACCESS_KEY:secret });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(fetchCount, 0);
});

test('worker rejects unknown parameters and invalid stops', async () => {
  const worker = loadWorker();
  assert.equal((await worker.fetch(request('/monitor?stopId=1687&extra=1'), { ACCESS_KEY:secret })).status, 400);
  assert.equal((await worker.fetch(request('/monitor?stopId=9999'), { ACCESS_KEY:secret })).status, 400);
  assert.equal((await worker.fetch(request('/other?stopId=1687'), { ACCESS_KEY:secret })).status, 404);
  assert.equal((await worker.fetch(request(`/monitor?${Array(9).fill('stopId=1687').join('&')}`), { ACCESS_KEY:secret })).status, 400);
});

test('worker forwards valid stops without duplicates and prevents caching', async () => {
  let requestedUrl = '';
  const worker = loadWorker(async url => {
    requestedUrl = String(url);
    return new Response('{"message":{"messageCode":1}}', {
      status:200,
      headers:{ 'Content-Type':'application/json; charset=utf-8' }
    });
  });
  const response = await worker.fetch(
    request('/monitor?stopId=1687&stopId=1687&stopId=754'),
    { ACCESS_KEY:secret }
  );
  assert.equal(response.status, 200);
  assert.equal(new URL(requestedUrl).search, '?stopId=1687&stopId=754');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('worker never exposes an upstream 401 as an access-key rejection', async () => {
  const worker = loadWorker(async () => new Response('Unauthorized', { status:401 }));
  const response = await worker.fetch(request(), { ACCESS_KEY:secret });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('WWW-Authenticate'), null);
});
