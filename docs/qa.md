# QA evidence — November 8, 2026

This is agent-operated verification, not human acceptance or proof of a remote deployment.

## Automated checks

- Node 22.23.4: 119 backend/telemetry/status tests passed at the delivery-completion checkpoint. They cover fallback modes, exact fullness thresholds, partial shard/aggregation/search failures, bounded input/output, auth, probes, venue-aware Plan B, pagination, secret boundaries and status-provider backoff.
- Backend timezone matrix: 109 app tests each under UTC, America/Denver and Asia/Tokyo (root rerun on the delivery-completion changes).
- Python: 50 tests passed at the delivery-completion checkpoint, including UTC/DST conversion, room clashes, real inference discovery schemas, exact runtime/eval query parity, blind pooling, partial labels and comparable-baseline enforcement.
- UI state checks: 11 passed, including query pagination races, fallback ordering changes, stale saved signals, per-response degradation, cross-tab saves, dialog return focus, service health and acknowledged crowd interest writes.
- Actual OTLP collector smoke on Node 22 received `/v1/traces`, `/v1/metrics`, and `/v1/logs`. This verifies local export only.
- Catalog validation: 470 unique scheduled entries, ordered UTC intervals, no selected same-room overlap. Capacities remain uniform estimates.
- Evaluation gate: `not_evaluated`, n=0. No human labels or baseline were invented.

## Browser and visual checks

Playwright Chromium, desktop 1440×1000, mobile 390×844, narrow 320×780:

- Search and empty-result recovery; day and track filters; final real-service pagination reached all 470 unique sessions, with no browser page errors.
- Session detail and Plan B; three real alternatives for an observed test session.
- Native dialog Escape and focus restoration; `/` focuses search outside text inputs.
- Device-only saved plan survives reload; calendar download contains selected QA events, CRLF lines and UTF-8 lines no longer than 75 octets.
- No horizontal overflow at 390px and 320px; reduced-motion preference recognized.
- Axe 4.14 scans of desktop discovery, Plan B, and phone discovery found zero WCAG 2 A/AA and 2.1 AA violations after contrast fixes. Automated scans are not a complete accessibility audit.
- Screenshots were visually inspected. Secondary-text contrast was corrected; the hero was shortened to expose sessions sooner; phone layout and dialog hierarchy were inspected.

Seven additional Playwright state checks passed: immediate pagination invalidation while typing; replacement by the new query's first page; native cross-tab save synchronization; useful focus after removing the final saved talk; stale stored crowd observations becoming unavailable; network-error recovery; and a nonempty Plan B displaying its own actual fallback mode/reason.

Five live-action UI checks passed with explicitly simulated API responses: visible supplied health metrics, separate shared-interest bookmark write, withdrawal, a failed write preserving prior state, and restoration to the real unconfigured unavailable status. These fixtures are not evidence of live Elasticsearch or Dash0. No external account writes occurred.

Six additional browser assertions verified hybrid-to-snapshot and rerank-to-hybrid pagination transitions: each restarts at offset zero, subsequent pages keep the selected ordering even if the provider recovers, and a new query clears the mode pin. These use real catalog records with explicitly simulated mode changes.

## Delivery completion checks

The actual Dash0 browser SDK was exercised in Chromium against a localhost collector on Node 22. The collector received Web Vitals, generic errors, safe events and an independent anonymous identity; the browser fetch span matched its backend trace and parent ID. A combined-payload check verified synthetic page/search/error/read-token markers were absent from browser, server and outbound spans. This test caught and fixed a stable OTel URL-query leak. No remote Dash0 ingestion is inferred.

The main 15 Playwright flows were rerun after the hybrid Plan B/RUM/contract integration, with three actual snapshot alternatives, zero checked axe violations and no narrow-screen overflow. Contract tests exercise all browser wrappers against the real local HTTP app and compare them with the runtime route inventory and declared caller roles. They are route coverage, not a complete formal validation of every response schema.

The final room-watch/Plan B browser fixture passed 17 scenarios. It exercises acknowledged registration, 15-second visible-page checks, bounded failure backoff, pause/resume, pending-write races, persistent named actions inside/outside native dialogs, current fullness propagation and stale/cleared observations becoming unknown. Fixture screenshots deliberately simulate crowd API responses; they are not evidence of physical occupancy or deployed provider traffic.

Fresh evaluation intentionally exits not_evaluated (n=0) without approved human evidence. Regression tests prove fresh provider failures can reject an old baseline, source/index mismatch cannot pass, and observed provider drift remains unavailable. Provider fixtures in these tests are not measured ranking results.

## Real local Elasticsearch

An isolated Elasticsearch 9.5.6 basic-license runtime indexed the same 470-record catalog. All 12 final API scenarios passed, plus capacity-boundary and nonvacuous full-room-exclusion checks. Actual ES|QL, strict aggregation parity, BM25, MLT Plan B, writes/alerts, mode persistence and fallback were exercised. Semantic mapping/inference was disabled. See [the bounded report](local-elasticsearch-qa.md). An initial critical memory-pressure guard ended the API run. A later strictly sequenced, supervised attempt completed only initial real browser browsing before renewed pressure stopped the temporary services. The full real-database browser workflow remains unverified; owned processes closed and test ports were checked clear.

## Independent review

Separate reviewers examined data/evaluation, backend, and UI. They found and re-reviewed fixes for incomparable eval baselines, ranking-query mismatch, partial crowd results represented as live zero, unbounded metrics responses, pagination races, stale persisted signals, missing mode disclosure, cross-tab controls, and dialog focus return.

A fresh whole-branch review then found incomplete alert searches, fallback pagination ordering and healthy/no-5xx status-query behavior. One fix wave addressed all three, and the scoped final re-review reported no remaining Important or Critical issue in that wave. Query semantics were checked against primary Prometheus documentation and fixtures; no real PromQL/Dash0 execution is claimed.

## Limits

- No verified remote Elasticsearch, inference endpoint, Dash0 account ingestion, Radar cluster, Gitar PR review or public deployment.
- Remote browser RUM, percolator alerts, hosted investigations, applied dashboards and SLOs are not claimed. Alerts use acknowledged subscriptions and visible-page polling. ES|QL counts have a strictly checked aggregation compatibility fallback; production crowd data is unverified.
- Docker CLI is absent locally. Remote GitHub container build and publication passed. The first remote CI exposed a browser-telemetry teardown race, now fixed in PR1 and verified by Linux CI42559268416 on a2e637f. Container, data, all three app time zones and all browser checks passed; fresh ranking evidence was skipped for this PR and remains unsatisfied. See [cloud delivery evidence](cloud-delivery.md).
- No completed live browser workflow against real Elasticsearch, human relevance labels, production latency benchmark, phone hardware test, screen-reader user study, recorded video, or submission exists from this session.
