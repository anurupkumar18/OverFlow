// Isolated state-transition checks. No browser session or external request is used.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app/public/js/app.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/\ninit\(\);\s*$/, '');
function harness() {
  const elements = new Map(); const storage = new Map(); const windowEvents = new Map(); const requests = [];
  const doc = { activeElement: null, title: '', addEventListener() {}, querySelectorAll: () => [] };
  function element(key) {
    if (elements.has(key)) return elements.get(key);
    const item = { innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, checked: false, open: false, isConnected: true, dataset: {}, attrs: {}, events: {},
      classList: { contains: () => false, toggle() {} }, parentElement: {}, closest: () => null,
      setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; },
      querySelector(selector) { return element(selector); }, querySelectorAll() { return []; }, addEventListener(name, fn) { this.events[name] = fn; },
      focus() { doc.activeElement = this; }, showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); },
    };
    elements.set(key, item); return item;
  }
  doc.querySelector = (selector) => selector.includes(' ') ? elements.get(selector) || null : element(selector);
  const api = {
    async search(filters) { requests.push(filters); return { items: [{ ...talk, id: 'new-first-page' }], total: 1, next_offset: null, mode: 'bm25', degraded: false }; },
    async talk() { return { item: talk, mode: 'snapshot', degraded: true, reason: 'Detail fallback reason' }; },
    async interaction(data) { requests.push(data); return {ok:true}; },
    async planB() { return { source_talk: talk, items: [{ ...talk, id: 'alternate', why_matched: 'Same time, different room' }], mode: 'hybrid', degraded: true, reason: 'Plan B fallback reason' }; },
  };
  const context = vm.createContext({ document: doc, window: { addEventListener: (name, fn) => windowEvents.set(name, fn) }, localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, api, icon: () => '', location: { hash: '' }, history: { replaceState() {} }, Intl, Date, Map, Set, URL, URLSearchParams, AbortController, TextEncoder, Blob, crypto: { randomUUID: () => '12345678-test' }, setTimeout: () => 1, clearTimeout() {}, console });
  vm.runInContext(source, context);
  return { run: (script) => vm.runInContext(script, context), elements, element, storage, windowEvents, requests, doc, api };
}
const talk = { id: 'one', title: 'A real session', speakers: ['Speaker'], start: '2026-11-10T17:00:00Z', end: '2026-11-10T17:35:00Z', capacity: 200, capacity_source: 'estimate', fullness: { signal: 'live', bookmarks: 199, reports: 4, pressure: 0.995, capacity: 200, capacity_source: 'estimate', likely_full: true } };
const tests = [
  ...[['hybrid','snapshot'],['snapshot','hybrid'],['hybrid','bm25'],['hybrid_rerank','hybrid']].map(([previousMode,nextMode]) => [
    `pagination restarts once and pins ${previousMode} to ${nextMode} ordering`, async () => {
      const h = harness(); let calls = 0;
      h.api.search = async filters => {
        h.requests.push(filters); calls++;
        return {items:[{...talk,id:calls < 3 ? 'refreshed-first' : 'refreshed-next'}],total:200,next_offset:calls < 3 ? 100 : null,mode:nextMode,degraded:nextMode==='snapshot'};
      };
      h.run(`state.filters.q='cloud'; state.completedFilters=filtersKey(); state.loaded=[{id:'old-order'}]; state.nextOffset=20; state.mode=${JSON.stringify(previousMode)};`);
      await h.run('search({append:true})');
      assert.equal(h.requests.length,2);assert.equal(h.requests[0].offset,20);assert.equal(h.requests[1].offset,0);assert.equal(h.requests[1].mode,nextMode);
      assert.equal(h.run('state.loaded.some(t=>t.id==="old-order")'),false);assert.equal(h.run('state.loaded[0].id'),'refreshed-first');assert.match(h.element('#toast').textContent,/refresh|first/i);
      await h.run('search({append:true})');
      assert.equal(h.requests.length,3);assert.equal(h.requests[2].offset,100);assert.equal(h.requests[2].mode,nextMode);assert.equal(h.run('state.loaded.length'),2);
      await h.run('search()');assert.equal(h.requests[3].mode,undefined);assert.equal(h.requests[3].offset,0);
    }
  ]),
  ['service health exposes only actual metrics or unavailable', async () => {
    const h = harness(); h.run('renderServiceHealth({status:"unavailable",p95_ms:null,error_ratio:null,degraded_share:null})');
    assert.match(h.element('#service-health').textContent, /unavailable/i); assert.doesNotMatch(h.element('#service-health').textContent, /0 ms/);
    h.run('renderServiceHealth({status:"available",p95_ms:123,error_ratio:0.02,degraded_share:0.1,as_of:"2026-11-08T22:00:00Z"})');
    assert.match(h.element('#service-health').textContent, /123 ms/); assert.match(h.element('#service-health').textContent, /2.0% errors/);
  }],
  ['crowd interest changes only after accepted writes and is separate from personal saves', async () => {
    const h = harness(); const button = h.element('interest-button'); button.dataset.id = 'one'; h.run('state.config={live_interactions:true}');
    h.run('globalThis.interestButton = document.querySelector("interest-button")');
    await h.run('liveAction(interestButton,"share-interest","one")');
    assert.equal(h.requests[0]?.type, 'bookmark'); assert.equal(h.run('state.sharedInterest.has("one")'), true); assert.equal(h.run('state.saved.size'), 0);
    await h.run('liveAction(interestButton,"share-interest","one")'); assert.equal(h.requests[1]?.type, 'unbookmark'); assert.equal(h.run('state.sharedInterest.has("one")'), false);
    h.run('api.interaction=async()=>{throw new Error("Live service unavailable")};'); await h.run('liveAction(interestButton,"share-interest","one")');
    assert.equal(h.run('state.sharedInterest.has("one")'), false);
  }],
  ['pagination starts at zero after an input change during debounce', async () => {
    const h = harness(); h.run('initEvents(); state.loaded = [{id:"old"}]; state.nextOffset = 100; state.completedFilters = JSON.stringify(state.filters);');
    h.element('#search-input').value = 'new'; h.element('#search-input').events.input();
    await h.run('search({append:true})');
    assert.equal(h.requests[0].offset, 0); assert.equal(h.run('state.loaded.some(t => t.id === "old")'), false);
  }],
  ['persisted crowd data is unknown until a current API response refreshes it', async () => {
    const h = harness(); h.storage.set('overflow.personal-plan.v1', JSON.stringify([talk])); h.run('loadSaved()');
    assert.equal(h.run('state.saved.get("one").fullness.signal'), 'unavailable');
    assert.equal(h.run('state.saved.get("one").fullness.likely_full'), null);
    h.run(`cacheTalk(${JSON.stringify(talk)})`);
    assert.equal(h.run('state.saved.get("one").fullness.signal'), 'live');
    h.run('persistSaved()'); const persisted = JSON.parse(h.storage.get('overflow.personal-plan.v1'))[0];
    assert.equal(persisted.fullness.signal, 'unavailable'); assert.equal(persisted.fullness.bookmarks, null);
  }],
  ['search, details and nonempty Plan B show their own response mode and degradation', async () => {
    const h = harness(); h.run('updateNotice({mode:"bm25",degraded:false})');
    assert.match(h.element('#notice-description').textContent + h.element('#notice-title').textContent, /bm25/);
    await h.run('openDetails("one")'); assert.match(h.element('#dialog-content').innerHTML, /snapshot/); assert.match(h.element('#dialog-content').innerHTML, /Detail fallback reason/);
    await h.run('openPlanB("one")'); assert.match(h.element('#dialog-content').innerHTML, /hybrid/); assert.match(h.element('#dialog-content').innerHTML, /Plan B fallback reason/);
  }],
  ['cross-tab storage reconciles row and dialog bookmark controls', async () => {
    const h = harness(); const row = h.element('row-save'); row.dataset.id = 'one'; const dialog = h.element('dialog-save'); dialog.dataset.id = 'one'; dialog.classList.contains = (name) => name === 'dialog-save';
    h.doc.querySelectorAll = (selector) => selector === '[data-action="save"]' ? [row, dialog] : [];
    h.run('initEvents()'); h.storage.set('overflow.personal-plan.v1', JSON.stringify([talk])); h.windowEvents.get('storage')({ key: 'overflow.personal-plan.v1' });
    assert.equal(row.attrs['aria-pressed'], 'true'); assert.match(row.attrs['aria-label'], /Remove/); assert.match(dialog.innerHTML, /Saved to my plan/);
  }],
  ['closing a dialog whose source disappeared focuses the empty-plan action', async () => {
    const h = harness(); const target = h.element('#plan-results [data-action="discover"]'); h.run('initEvents(); state.view="plan"; state.lastFocus={isConnected:false};');
    h.element('#talk-dialog').events.close(); assert.equal(h.doc.activeElement, target);
  }],
];
(async () => { let failed = 0; for (const [name, test] of tests) { try { await test(); console.log(`PASS ${name}`); } catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); } } console.log(`${tests.length - failed}/${tests.length} passed`); process.exitCode = failed ? 1 : 0; })();
