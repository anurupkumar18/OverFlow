# QA evidence — November 8, 2026

This is agent-operated verification, not human acceptance or proof of a remote deployment.

## Automated checks

- Node 22.23.4: 36 backend/telemetry/status tests passed. They cover fallback modes, exact fullness thresholds, partial shard/aggregation failures, bounded input/output, auth, probes, venue-aware Plan B, pagination, secret boundaries and status-provider backoff.
- Backend timezone matrix: 30 tests each under UTC, America/Denver and Asia/Tokyo (final root rerun recorded in build ledger).
- Python: 27 tests passed, including UTC/DST conversion, room clashes, real inference discovery schemas, exact runtime/eval query parity, blind pooling, partial labels and comparable-baseline enforcement.
- UI state checks: 7 passed, including query pagination races, stale saved signals, per-response degradation, cross-tab saves, dialog return focus, service health and acknowledged crowd interest writes.
- Actual OTLP collector smoke on Node 22 received `/v1/traces`, `/v1/metrics`, and `/v1/logs`. This verifies local export only.
- Catalog validation: 470 unique scheduled entries, ordered UTC intervals, no selected same-room overlap. Capacities remain uniform estimates.
- Evaluation gate: `not_evaluated`, n=0. No human labels or baseline were invented.

## Browser and visual checks

Playwright Chromium, desktop 1440×1000, mobile 390×844, narrow 320×780:

- Search and empty-result recovery; day and track filters; pagination reaches beyond the first 100.
- Session detail and Plan B; three real alternatives for an observed test session.
- Native dialog Escape and focus restoration; `/` focuses search outside text inputs.
- Device-only saved plan survives reload; calendar download contains two selected QA events, CRLF lines and UTF-8 lines no longer than 75 octets.
- No horizontal overflow at 390px and 320px; reduced-motion preference recognized.
- Axe 4.14 scans of desktop discovery, Plan B, and phone discovery found zero WCAG 2 A/AA and 2.1 AA violations after contrast fixes. Automated scans are not a complete accessibility audit.
- Screenshots were visually inspected. Secondary-text contrast was corrected; the hero was shortened to expose sessions sooner; phone layout and dialog hierarchy were inspected.

Focused browser regression checks use explicitly simulated API failures and crowd observations; those fixtures are not evidence of live Elasticsearch or Dash0. Final state-transition results are recorded in the build ledger and will be summarized here after the final run.

## Independent review

Separate reviewers examined data/evaluation, backend, and UI. They found and re-reviewed fixes for incomparable eval baselines, ranking-query mismatch, partial crowd results represented as live zero, unbounded metrics responses, pagination races, stale persisted signals, missing mode disclosure, cross-tab controls, and dialog focus return.

## Limits

- No verified remote Elasticsearch, inference endpoint, Dash0 account ingestion, Radar cluster, Gitar PR review or public deployment.
- Browser RUM, percolator alerts, ES|QL crowd aggregation, hosted investigations, dashboards and SLOs are not claimed. Alerts currently use explicit polling/check actions and Elasticsearch aggregations.
- Docker CLI is absent on this machine, so local container build was not run. A container build job is included in CI but has not run remotely.
- No human relevance labels, production latency benchmark, phone hardware test, screen-reader user study, recorded video, or submission exists from this session.
