import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
if (!script) throw new Error('Inline application script not found');

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name)
  };
}

function createElement() {
  return {
    addEventListener() {},
    classList:createClassList(),
    className:'',
    disabled:false,
    hidden:false,
    innerHTML:'',
    setAttribute() {},
    textContent:'',
    value:''
  };
}

function loadFrontend({ fetchImpl } = {}) {
  const elements = new Map([
    ['#board', createElement()],
    ['#notice', createElement()],
    ['#access-panel', createElement()],
    ['#access-form', createElement()],
    ['#access-key', createElement()],
    ['#access-error', createElement()],
    ['#updated', createElement()],
    ['#refresh', createElement()]
  ]);
  const timers = new Map();
  let nextTimerId = 1;
  const storage = new Map();
  const document = {
    hidden:false,
    focused:true,
    addEventListener() {},
    hasFocus() { return this.focused; },
    querySelector:selector => elements.get(selector)
  };
  const navigator = { onLine:true };
  const context = vm.createContext({
    AbortController,
    Date,
    Intl,
    Object,
    Promise,
    Set,
    String,
    URL,
    clearTimeout:id => timers.delete(id),
    document,
    fetch:fetchImpl ?? (async () => { throw new Error('Unexpected fetch in unit test'); }),
    localStorage:{
      getItem:key => storage.get(key) ?? null,
      removeItem:key => storage.delete(key),
      setItem:(key, value) => storage.set(key, value)
    },
    location:{ hostname:'127.0.0.1', origin:'http://127.0.0.1:8080', reload() {} },
    navigator,
    performance:{ now:() => 0 },
    requestAnimationFrame:callback => callback(),
    setTimeout:(callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    window:{ addEventListener() {} }
  });
  vm.runInContext(`${script}\n;globalThis.__testApi = {
    CONFIG,
    normalize,
    normalizeAccessKey,
    render,
    scheduleAutoRefresh,
    cancelAutoRefresh,
    validApiPayload,
    loadDepartures,
    pauseBackgroundWork,
    showDeparturesInterface,
    setAccessKey(value) { accessKey = value; }
  };`, context);
  return { api:context.__testApi, document, elements, navigator, storage, timers };
}

test('access keys are trimmed and bounded', () => {
  const { api } = loadFrontend();
  assert.equal(api.normalizeAccessKey('  abc-123  '), 'abc-123');
  assert.equal(api.normalizeAccessKey('contains space'), '');
  assert.equal(api.normalizeAccessKey('x'.repeat(257)), '');
  assert.equal(api.normalizeAccessKey(null), '');
  assert.equal(api.normalizeAccessKey('ä'), '');
  assert.equal(api.normalizeAccessKey('abc\u0000'), '');
});

test('API normalization is defensive and prefers valid real-time values', () => {
  const { api } = loadFrontend();
  const result = api.normalize({ data:{ monitors:[
    null,
    { locationStop:{ properties:{ attributes:{ rbl:1687 } } }, lines:[
      { name:'59A', towards:'Bhf. Meidling S U', departures:{ departure:[
        { departureTime:{ countdown:5, timeReal:'invalid', timePlanned:'2026-08-07T13:00:00.000+0200' } },
        { departureTime:{ countdown:61, timePlanned:'2026-08-07T13:01:00.000+0200' } },
        { departureTime:{ countdown:2 } },
        ...[null, '', ' ', false, true].map(countdown => ({
          departureTime:{ countdown, timePlanned:'2026-08-07T13:00:00.000+0200' }
        }))
      ] } }
    ] }
  ] } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{
    stopId:'1687',
    line:'59A',
    vehicleTowards:'Bhf. Meidling S U',
    countdown:5,
    time:'2026-08-07T13:00:00.000+0200'
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalize({ data:{ monitors:{} } }))), []);
  assert.equal(api.validApiPayload({ message:{ messageCode:1 }, data:{ monitors:[] } }), true);
  assert.equal(api.validApiPayload({ message:{ messageCode:1 }, data:{ monitors:{} } }), false);
});

test('only short-running buses show a destination warning, without transport suffixes', () => {
  const { api, elements } = loadFrontend();
  api.render([
    {
      stopId:'1687', line:'59A', vehicleTowards:'Matzleinsdorfer Platz S',
      countdown:4, time:'2026-08-07T13:00:00.000+0200'
    },
    {
      stopId:'1698', line:'59A', vehicleTowards:'Oper, Karlsplatz U',
      countdown:8, time:'2026-08-07T13:04:00.000+0200'
    }
  ]);
  const output = elements.get('#board').innerHTML;
  assert.match(output, /destination-tag/u);
  assert.match(output, />To Matzleinsdorfer Platz</u);
  assert.doesNotMatch(output, /Matzleinsdorfer Platz S/u);
  assert.equal((output.match(/destination-tag/gu) ?? []).length, 1);
});

test('automatic refresh is scheduled only while visible, online and authenticated', () => {
  const { api, document, navigator, timers } = loadFrontend();
  api.setAccessKey('abc-123');
  api.scheduleAutoRefresh();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, api.CONFIG.refreshMs);

  api.cancelAutoRefresh();
  document.hidden = true;
  api.scheduleAutoRefresh();
  assert.equal(timers.size, 0);

  document.hidden = false;
  navigator.onLine = false;
  api.scheduleAutoRefresh();
  assert.equal(timers.size, 0);

  navigator.onLine = true;
  document.focused = false;
  api.scheduleAutoRefresh();
  assert.equal(timers.size, 0);
});

test('successful loading combines all stops and stores the validated key', async () => {
  let requestedUrl = '';
  let requestedAuthorization = '';
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestedAuthorization = options.headers.Authorization;
    return {
      ok:true,
      status:200,
      async json() {
        return {
          message:{ messageCode:1 },
          data:{ monitors:[{
            locationStop:{ properties:{ attributes:{ rbl:1687 } } },
            lines:[{
              name:'59A', towards:'Bhf. Meidling S U',
              departures:{ departure:[{
                departureTime:{ countdown:3, timeReal:'2026-08-07T13:00:00.000+0200' }
              }] }
            }]
          }] }
        };
      }
    };
  };
  const { api, elements, storage } = loadFrontend({ fetchImpl });
  api.setAccessKey('abc-12345');
  api.showDeparturesInterface();
  await api.loadDepartures({ initial:true });

  const url = new URL(requestedUrl);
  assert.deepEqual(url.searchParams.getAll('stopId'), ['1687', '1698', '754', '1699']);
  assert.equal(requestedAuthorization, 'Bearer abc-12345');
  assert.equal(storage.get('vienna-bus-departures-access-key'), 'abc-12345');
  assert.match(elements.get('#board').innerHTML, /Bhf\. Meidling/u);
  assert.match(elements.get('#updated').textContent, /^\d{2}:\d{2}$/u);
});

test('a 401 response removes the stored key and returns to access entry', async () => {
  const fetchImpl = async () => ({ ok:false, status:401 });
  const { api, elements, storage } = loadFrontend({ fetchImpl });
  storage.set('vienna-bus-departures-access-key', 'abc-12345');
  api.setAccessKey('abc-12345');
  api.showDeparturesInterface();
  await api.loadDepartures({ initial:true });

  assert.equal(storage.has('vienna-bus-departures-access-key'), false);
  assert.equal(elements.get('#access-panel').hidden, false);
  assert.equal(elements.get('#board').hidden, true);
  assert.equal(elements.get('#access-error').hidden, false);
});

test('background cancellation discards a late response even after returning to the app', async () => {
  let resolveResponse;
  let signal;
  const fetchImpl = (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { resolveResponse = resolve; });
  };
  const { api, document, elements, storage, timers } = loadFrontend({ fetchImpl });
  api.setAccessKey('abc-12345');
  api.showDeparturesInterface();
  const pending = api.loadDepartures({ initial:true });
  document.focused = false;
  api.pauseBackgroundWork();
  assert.equal(signal.aborted, true);
  document.focused = true;
  resolveResponse({ ok:true, status:200, async json() {
    return { message:{ messageCode:1 }, data:{ monitors:[] } };
  } });
  await pending;
  assert.equal(storage.size, 0);
  assert.equal(elements.get('#updated').textContent, '');
  assert.match(elements.get('#board').innerHTML, /skeleton/u);
  assert.equal(timers.size, 0);
});

test('backgrounding cancels the minimum refresh delay and releases the button', async () => {
  const { api, document, elements, timers } = loadFrontend({ fetchImpl:async () => ({
    ok:true, status:200, async json() {
      return { message:{ messageCode:1 }, data:{ monitors:[] } };
    }
  }) });
  api.setAccessKey('abc-12345');
  const pending = api.loadDepartures({ manual:true });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok([...timers.values()].some(timer => timer.delay === api.CONFIG.minRefreshIndicatorMs));
  document.focused = false;
  api.pauseBackgroundWork();
  const { classList } = elements.get('#refresh');
  await pending;
  assert.equal(classList.contains('loading'), false);
  assert.equal(elements.get('#refresh').disabled, false);
  assert.equal(timers.size, 0);
});
