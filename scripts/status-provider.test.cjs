const test = require('node:test');
const assert = require('node:assert/strict');

test('unconfigured status makes no external request', async () => {
  const { createStatusProvider } = require('../app/status-provider.cjs');
  let calls = 0;
  const status = await createStatusProvider({ env: {}, fetchImpl: async () => { calls++; } })();
  assert.equal(status.status, 'unavailable');
  assert.equal(status.p95_ms, null);
  assert.equal(calls, 0);
});

test('status uses real samples, caches 20 seconds and never returns the token', async () => {
  const { createStatusProvider } = require('../app/status-provider.cjs');
  let calls = 0;
  const read = createStatusProvider({ env: { DASH0_API_URL: 'https://dash.example', DASH0_READ_TOKEN: 'secret-value' }, clock: () => 1700000000000,
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ status:'success', data: { result: [{ value: [1700000000, calls === 1 ? '42.5' : '0.1'] }] } })); } });
  const first = await read();
  assert.equal(first.p95_ms, 42.5);
  assert.equal(first.error_ratio, 0.1);
  assert.equal(first.degraded_share, 0.1);
  assert.equal(calls, 3);
  assert.deepEqual(await read(), first);
  assert.equal(calls, 3);
  assert.ok(!JSON.stringify(first).includes('secret-value'));
});

test('429 backoff honors Retry-After instead of continuously querying', async () => {
  const { createStatusProvider } = require('../app/status-provider.cjs');
  let calls = 0; let now = 1700000000000;
  const read = createStatusProvider({ env: { DASH0_API_URL:'https://dash.example', DASH0_READ_TOKEN:'secret' }, clock: () => now,
    fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); } });
  assert.equal((await read()).status, 'unavailable');
  now += 30000;
  assert.equal((await read()).status, 'unavailable');
  assert.equal(calls, 1);
  now += 31000;
  await read();
  assert.equal(calls, 2);
});

test('oversized metrics payload is unavailable instead of consuming an unbounded body', async () => {
  const { createStatusProvider } = require('../app/status-provider.cjs');
  const read = createStatusProvider({ env: { DASH0_API_URL:'https://dash.example', DASH0_READ_TOKEN:'secret' },
    fetchImpl: async () => new Response(JSON.stringify({status:'success',data:{result:[{value:[1700000000,'0.1']}]},padding:'x'.repeat(70000)})) });
  assert.equal((await read()).status, 'unavailable');
});

test('healthy traffic uses a zero-only error numerator without inventing a total request series', async () => {
  const { createStatusProvider } = require('../app/status-provider.cjs');
  const observed = [];
  const read = createStatusProvider({ env: { DASH0_API_URL:'https://dash.example', DASH0_READ_TOKEN:'secret' },
    fetchImpl: async url => {
      const query = url.searchParams.get('query'); observed.push(query);
      const errorQuery = '(sum(rate(overflow_search_requests_total{service_name="overflow",http_response_status_code=~"5.."}[5m])) or on() vector(0)) / (sum(rate(overflow_search_requests_total{service_name="overflow"}[5m])) > 0)';
      // This is the emitted query boundary, not an in-test PromQL evaluator.
      if (query.includes('http_response_status_code')) assert.equal(query,errorQuery);
      return Response.json({status:'success',data:{result:[{value:[1700000000,query.includes('histogram_quantile')?'42.5':query.includes('http_response_status_code')?'0':'0.1']}]}});
    } });
  const status = await read();
  assert.equal(status.status,'available');assert.equal(status.error_ratio,0);assert.equal(status.p95_ms,42.5);assert.equal(observed.length,3);
});

for (const [name,result] of [
  ['absent traffic',[]],
  ['zero total traffic',[{value:[1700000000,'NaN']}]],
]) {
  test(name+' remains unavailable rather than a synthetic healthy zero', async () => {
    const { createStatusProvider } = require('../app/status-provider.cjs');
    const read = createStatusProvider({ env: { DASH0_API_URL:'https://dash.example', DASH0_READ_TOKEN:'secret' },
      fetchImpl: async url => Response.json({status:'success',data:{result:url.searchParams.get('query').includes('http_response_status_code')?result:[{value:[1700000000,'42.5']}]}}) });
    const status=await read();assert.equal(status.status,'unavailable');assert.equal(status.error_ratio,null);assert.equal(status.p95_ms,null);
  });
}
