'use strict';

const unavailable = () => ({ status: 'unavailable', p95_ms: null, error_ratio: null, degraded_share: null, as_of: null });
const selector = 'service_name="overflow"';
const total = `sum(rate(overflow_search_requests_total{${selector}}[5m]))`;
const queries = {
  p95_ms: `histogram_quantile(0.95, sum by (le) (rate(overflow_search_duration_milliseconds_bucket{${selector}}[5m])))`,
  error_ratio: `sum(rate(overflow_search_requests_total{${selector},http_response_status_code=~"5.."}[5m])) / ${total}`,
  degraded_share: `sum(rate(overflow_search_degraded_total{${selector}}[5m])) / ${total}`,
};

function createStatusProvider({ env = process.env, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  let cached = unavailable();
  let expires = 0;
  let pending;
  return async function status() {
    if (!env.DASH0_API_URL || !env.DASH0_READ_TOKEN) return unavailable();
    if (clock() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const next = { status: 'available', as_of: new Date(clock()).toISOString() };
      let ttl = 20000;
      try {
        for (const [key, query] of Object.entries(queries)) {
          const url = new URL('/api/prometheus/api/v1/query', env.DASH0_API_URL);
          if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('TLS required');
          url.searchParams.set('query', env[`DASH0_QUERY_${key.toUpperCase()}`] || query);
          const response = await fetchImpl(url, {
            headers: { Authorization: `Bearer ${env.DASH0_READ_TOKEN}`, ...(env.DASH0_DATASET ? { 'Dash0-Dataset': env.DASH0_DATASET } : {}) },
            signal: AbortSignal.timeout(2500), redirect: 'error',
          });
          if (response.status === 429) {
            const raw = response.headers.get('retry-after');
            const delay = /^\d+$/.test(raw || '') ? Number(raw) * 1000 : Date.parse(raw) - clock();
            ttl = Number.isFinite(delay) ? Math.max(ttl, Math.min(delay, 300000)) : ttl;
          }
          if (!response.ok) throw new Error('Metrics unavailable');
          const body = await response.json();
          const samples = body?.data?.result;
          if (body.status !== 'success' || !Array.isArray(samples) || samples.length !== 1) throw new Error('No aggregate sample');
          const sample = Number(samples[0]?.value?.[1]);
          if (!Number.isFinite(sample) || sample < 0 || (key !== 'p95_ms' && sample > 1)) throw new Error('No valid sample');
          next[key] = sample;
        }
        cached = next;
      } catch { cached = unavailable(); }
      expires = clock() + ttl;
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  };
}
module.exports = { createStatusProvider };
