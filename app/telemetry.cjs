'use strict';

// Preload before node:http so server spans and W3C traceparent propagation work.
// Without an OTLP endpoint this module creates no exporter and makes no calls.
const enabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
let sdk;
let api;
let logApi;
let requests;
let degraded;
let duration;

if (enabled) {
  api = require('@opentelemetry/api');
  logApi = api; // Logs are part of the stable API in @opentelemetry/api 1.10+.
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  process.env.OTEL_SERVICE_NAME ||= 'overflow';
  process.env.OTEL_TRACES_EXPORTER ||= 'otlp';
  process.env.OTEL_METRICS_EXPORTER ||= 'otlp';
  process.env.OTEL_LOGS_EXPORTER ||= 'otlp';
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL ||= 'http/protobuf';
  process.env.OTEL_EXPORTER_OTLP_TIMEOUT ||= '2000';
  process.env.OTEL_RESOURCE_ATTRIBUTES = [process.env.OTEL_RESOURCE_ATTRIBUTES,
    `service.version=${(process.env.APP_VERSION || 'dev').replace(/[^a-zA-Z0-9._-]/g, '')}`,
    `deployment.environment.name=${process.env.NODE_ENV === 'production' ? 'production' : 'development'}`
  ].filter(Boolean).join(',');
  sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: req => ['/healthz', '/readyz'].includes(req.url?.split('?')[0]),
      requestHook(span, req) {
        // Keep query text, attendee ids and credentials out of span attributes.
        if (req.url) {
          span.setAttribute('http.target', req.url.split('?')[0]);
          span.setAttribute('http.url', req.url.split('?')[0]);
        }
      },
    },
  })] });
  sdk.start();
  const meter = api.metrics.getMeter('overflow');
  requests = meter.createCounter('overflow.search.requests', { description: 'Completed search and Plan B requests' });
  degraded = meter.createCounter('overflow.search.degraded', { description: 'Search requests served with a fallback' });
  duration = meter.createHistogram('overflow.search.duration', { unit: 'ms', description: 'Search and Plan B request duration' });
}

function searchLog(input) {
  const context = api?.trace.getSpan(api.context.active())?.spanContext();
  return {
    event: 'search.completed',
    search_mode: String(input.mode || 'unknown'),
    degraded: Boolean(input.degraded),
    duration_ms: Number.isFinite(input.duration_ms) ? input.duration_ms : 0,
    result_count: Number.isFinite(input.count) ? input.count : null,
    ...(context ? { trace_id: context.traceId, span_id: context.spanId } : {}),
  };
}

function observe(input) {
  try {
    if (!['/api/search', '/api/planb/:id'].includes(input.route)) return;
    const attrs = { 'search.mode': String(input.mode || 'unknown'), 'http.route': input.route, 'http.response.status_code': Number(input.status || 200) };
    requests?.add(1, attrs);
    degraded?.add(input.degraded ? 1 : 0, attrs);
    duration?.record(Math.max(0, Number(input.duration_ms) || 0), attrs);
    const entry = searchLog(input);
    logApi?.logs.getLogger('overflow').emit({ severityNumber: 9, severityText: 'INFO', body: entry.event, attributes: entry });
    if (process.env.NODE_ENV !== 'test') process.stdout.write(`${JSON.stringify(entry)}\n`);
  } catch { /* Instrumentation must never fail a user request. */ }
}

async function withStage(name, fn) {
  if (!api) return fn();
  return api.trace.getTracer('overflow').startActiveSpan(`search.${name}`, async span => {
    try { return await fn(); }
    catch (error) { span.setStatus({ code: api.SpanStatusCode.ERROR, message: 'Search stage unavailable' }); throw error; }
    finally { span.end(); }
  });
}

async function shutdownTelemetry() { if (sdk) await sdk.shutdown(); }

module.exports = { observe, withStage, searchLog, shutdownTelemetry };
