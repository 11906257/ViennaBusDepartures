import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('release versions and cache-busting query strings remain synchronized', () => {
  const index = read('index.html');
  const serviceWorker = read('service-worker.js');
  const worker = read('proxy/cloudflare-worker.js');
  const developmentServer = read('dev-server.py');
  const manifest = read('manifest.webmanifest');

  const version = index.match(/const APP_VERSION = '(v\d+)'/u)?.[1];
  assert.ok(version);
  assert.equal(serviceWorker.match(/const CACHE_VERSION = '(v\d+)'/u)?.[1], version);
  assert.equal(worker.match(/const APP_VERSION = '(v\d+)'/u)?.[1], version);
  assert.equal(developmentServer.match(/APP_VERSION = "(v\d+)"/u)?.[1], version);

  const numericVersion = version.slice(1);
  for (const source of [index, serviceWorker, manifest]) {
    for (const match of source.matchAll(/\?v=(\d+)/gu)) assert.equal(match[1], numericVersion);
  }
});

test('manifest and app-shell files are valid and present', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(icon.src.split('?')[0], root)), `Missing ${icon.src}`);
  }

  const shell = read('service-worker.js').match(/const APP_SHELL = \[([\s\S]*?)\];/u)?.[1];
  assert.ok(shell);
  for (const match of shell.matchAll(/'([^']+)'/gu)) {
    const path = match[1].split('?')[0];
    if (path === './') continue;
    assert.ok(existsSync(new URL(path, root)), `Missing app-shell file ${path}`);
  }
});
