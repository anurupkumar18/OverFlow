# Evidence status

This is a build evidence register, not a claim to have satisfied all judging criteria.

| Area | Local evidence | External evidence still needed |
|---|---|---|
| Elasticsearch | Actual local470-record index;12 API scenarios, ES|QL/aggregation, BM25/MLT, writes/alerts and full-room exclusion; hybrid adapter tests | Owned cloud index/inference; browser-on-real-ES; human labels and measured comparison |
| Dash0 | Actual traces, metrics and logs plus browser Web Vitals/events/errors and linked browser/backend spans received by a local collector | Real Dash0 ingestion/query/correlation, dashboard, real Agent0 finding |
| Radar | Starter manifests retained; optional credentials; direct probes | Verified team cluster, actual deployment revision/image/URL, Checks, investigation and decision |
| Gitar | Review/rule/config files and PR template prepared; no review invented | User repository/App access, actual reviewed PRs and responses |
| Accessibility | Playwright keyboard/mobile flows and screenshot review; zero axe violations in checked discovery/Plan B views | Human assistive-technology evaluation |
| Evaluation | Honest no-label initial state | Human-labeled queries; n, recall/MRR/latency per arm; accepted baseline |

The build starts November 8, before the published official coding window. The repository must disclose this. Eligibility is not established by this implementation.

See `completion-audit.md` for the requirement ledger and `local-elasticsearch-qa.md` for database evidence and its resource limit. Container execution, real inference, browser-on-real-Elasticsearch and account/human evidence remain outstanding.
