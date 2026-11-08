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
- Browser RUM and its linked backend trace in the real Dash0 account (local collector correlation is verified).
- A real Agent0 finding and resulting human decision, if any.
- Dashboard/SLO/synthetic-check resources applied to a real account (not created here).

Do not claim these from a local SDK unit test.

## Browser telemetry

`npm --prefix app start` first builds a local SDK bundle. The Docker builder builds that bundle before pruning development dependencies; the final process still runs as non-root. No CDN or remote script is loaded. `@dash0/sdk-web` is pinned to0.30.0. Actual Docker execution remains unverified on this host.

Set `DASH0_BROWSER_ENABLED=true`, `DASH0_BROWSER_ENDPOINT` to the account's HTTPS ingest origin, `DASH0_BROWSER_DATASET`, and a dedicated `DASH0_BROWSER_TOKEN`. The token is intentionally public and must have ingest-only permission restricted to that dataset. Never reuse a server OTLP token or a read/admin/Elasticsearch credential. Missing, invalid or reused credentials leave browser telemetry disabled. CSP permits only the explicit ingest origin in addition to this app. Loopback HTTP is accepted only outside production for the local smoke.

The SDK captures navigation, Web Vitals and same-origin fetch traces. An independent anonymous `rum-` identity and an allowlist of action names support correlation without sending search text or attendee IDs. Error listeners emit generic categories, without raw messages/stacks. URL query strings/fragments are removed; unknown paths are redacted. Session replay/profiling is not enabled. SDK failures do not block product actions.

To repeat the real local collector check:

```sh
npm ci --prefix app
npm run build:browser --prefix app
npx --prefix app playwright install chromium
node scripts/browser-otlp-smoke.cjs
```

On a machine with Chrome installed, `BROWSER_CHANNEL=chrome node scripts/browser-otlp-smoke.cjs` uses that browser. The script uses temporary loopback services and a fake ingest-only test token; it does not connect to Dash0. It checks Web Vitals, generic errors, actions, identity, actual traceparent/backend-parent linkage, input redaction across browser/server/outbound spans and browser errors. It caught and led to a fix for a stable OTel `url.query` attribute that the old legacy-only scrubber missed.

SDK reference: [official Dash0 Web SDK](https://github.com/dash0hq/dash0-sdk-web). Real account ingestion, retention, token permissions and dashboard queries require separate verification.

## Prepared dashboard

`dashboard.yaml` contains a four-panel service overview: request rate, p95 milliseconds, server-error ratio and degraded-response share. It uses the same metric-name convention as the server status adapter. Layout references/YAML were checked locally; no dashboard was applied or rendered in Dash0, and no series/result is claimed. Missing traffic remains missing data rather than a fabricated healthy zero. Search/Plan B instrumentation excludes probe and status routes by construction. Synthetic checks have not been provisioned; any future synthetic search traffic needs its exclusion verified.

Once connected to the intended account/dataset, inspect actual series and units, adjust queries if the collector uses a different naming/native-histogram representation, then import using the configured Dash0 CLI profile:

```sh
dash0 dashboards create -f observability/dashboard.yaml
```

Record the created dashboard URL only after verifying all four panels. This asset is intentionally not in Kubernetes kustomization; it must not cause an operator installation or mutation of pre-installed components. No SLO/synthetic resources were invented from an unverified endpoint.

The source follows Dash0's [chart format](https://www.dash0.com/docs/dash0/dashboards/reference-dashboard-source-format) and [dashboard-as-code workflow](https://www.dash0.com/docs/dash0/dashboards/manage-dashboards-as-code). Account application and PromQL execution are separate evidence requirements.

References: [OTel Node SDK](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/), [Dash0 Prometheus API](https://www.dash0.com/docs/api-reference/operations/get/api/prometheus/api/v1/query).
