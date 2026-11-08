const test = require('node:test');
const assert = require('node:assert/strict');

test('structured search log does not leak query text or arbitrary credentials', async () => {
  const { searchLog } = require('../app/telemetry.cjs');
  const log = searchLog({ mode: 'snapshot', degraded: true, duration_ms: 12.3, count: 5, query: 'private query', token: 'sensitive-key' });
  assert.equal(log.event, 'search.completed');
  assert.equal(log.search_mode, 'snapshot');
  assert.equal(log.degraded, true);
  assert.equal(log.result_count, 5);
  assert.equal(log.duration_ms, 12.3);
  assert.ok(!JSON.stringify(log).includes('private query'));
  assert.ok(!JSON.stringify(log).includes('sensitive-key'));
});

test('stage wrapper returns result and preserves rejection without serializing error secrets', async () => {
  const { withStage } = require('../app/telemetry.cjs');
  assert.equal(await withStage('snapshot', async () => 42), 42);
  const error = new Error('private upstream response');
  await assert.rejects(withStage('semantic', async () => { throw error; }), e => e === error);
});

test('HTTP telemetry sanitizes stable and legacy URL attributes for incoming and outgoing requests',()=>{
  const { httpTelemetryAttributes }=require('../app/telemetry.cjs');
  for(const request of [
    {url:'/api/search?q=private-query&attendee_id=private-id'},
    {url:'/api/talks/private-id?key=private-key'},
    {path:'/private-id?key=private-key',origin:'https://user:private-key@example.test'},
  ]) {
    const attrs=httpTelemetryAttributes(request);
    assert.ok(!JSON.stringify(attrs).includes('private-'));
    assert.equal(attrs['url.query'],'');assert.equal(attrs['url.fragment'],'');
  }
  assert.equal(httpTelemetryAttributes({url:'/api/talks/id'})['url.path'],'/api/talks/:id');
  assert.equal(httpTelemetryAttributes({url:'/api/search?q=test'})['http.target'],'/api/search');
});
