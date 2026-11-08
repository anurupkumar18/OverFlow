# Observability

The Node process preloads `app/telemetry.cjs`. With `OTEL_EXPORTER_OTLP_ENDPOINT` unset, no exporter starts and the app remains usable. With a configured OTLP endpoint, traces, metrics and structured logs use the OpenTelemetry SDK and production dependencies. Search logs allowlist fields and omit query text, attendee identifiers and credentials.

Resource attributes: `service.name=overflow`, `service.version=APP_VERSION`, `deployment.environment.name`. Native HTTP instrumentation handles W3C trace context. Search stage spans are `search.<stage>`. Probe routes are excluded from HTTP traces.

Metrics: `overflow.search.requests`, `overflow.search.degraded`, `overflow.search.duration` (ms). The application records search and Plan B responses only, so probes and status queries do not affect them. No production latency or error-rate numbers have been measured yet.

## Dash0 connection

Set server-side `DASH0_API_URL`, `DASH0_READ_TOKEN` (query permission) and `DASH0_DATASET`. Do not expose them to the browser. `/api/status` queries the Prometheus API and returns explicit unavailable on missing/invalid data. Results cache for 20 seconds; 429 responses honor bounded Retry-After. Metric naming can differ by collector: verify the actual series and set `DASH0_QUERY_P95_MS`, `DASH0_QUERY_ERROR_RATIO`, `DASH0_QUERY_DEGRADED_SHARE` if needed. Defaults use Prometheus-converted metric names. The endpoint never turns missing data into zero.

Read token and OTLP ingestion authorization are distinct. Use the region endpoints shown by your Dash0 account. Configure secrets outside git; `.env.example` lists key names only.

## Evidence still required

- A trace with the served version and search-stage spans.
- A structured log with a matching trace id.
- Search counter/histogram data in Dash0; verify Prometheus queries against actual series.
- Browser RUM and its linked backend trace (not implemented in this first local build).
- A real Agent0 finding and resulting human decision, if any.
- Dashboard/SLO/synthetic-check resources applied to a real account (not created here).

Do not claim these from a local SDK unit test.

References: [OTel Node SDK](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/), [Dash0 Prometheus API](https://www.dash0.com/docs/api-reference/operations/get/api/prometheus/api/v1/query).
