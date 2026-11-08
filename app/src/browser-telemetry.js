// The browser ingest token is intentionally public. Never reuse a server token.
function browserTelemetryConfig(env = {}) {
  const disabled = {enabled:false};
  if (env.DASH0_BROWSER_ENABLED !== 'true') return disabled;
  const token = env.DASH0_BROWSER_TOKEN || '';
  const dataset = env.DASH0_BROWSER_DATASET || '';
  if (!/^auth_[A-Za-z0-9._~-]{6,2048}$/.test(token) || !/^[A-Za-z0-9_-]{1,128}$/.test(dataset)) return disabled;
  const privateValues = ['ES_API_KEY','ES_ADMIN_KEY','ES_READ_KEY','ADMIN_TOKEN','DASH0_READ_TOKEN'].map(key=>env[key]).filter(Boolean);
  for (const name of ['OTEL_EXPORTER_OTLP_HEADERS','OTEL_EXPORTER_OTLP_TRACES_HEADERS','OTEL_EXPORTER_OTLP_METRICS_HEADERS','OTEL_EXPORTER_OTLP_LOGS_HEADERS']) {
    for (const header of (env[name] || '').split(',')) {
      try { privateValues.push(decodeURIComponent(header.slice(header.indexOf('=')+1)).replace(/^Bearer\s+/i,'')); } catch { return disabled; }
    }
  }
  if (privateValues.includes(token)) return disabled;
  let endpoint;
  try {
    endpoint = new URL(env.DASH0_BROWSER_ENDPOINT);
    const local = env.NODE_ENV !== 'production' && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) return disabled;
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') return disabled;
  } catch { return disabled; }
  return {enabled:true,endpoint:endpoint.origin,token,dataset,environment:env.NODE_ENV==='production'?'production':'development'};
}
module.exports = {browserTelemetryConfig};
