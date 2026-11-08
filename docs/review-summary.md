# Independent review summary

Independent task reviewers and a fresh whole-branch reviewer inspected the initial build. The delivery completion wave received additional focused reviews for ranking, CI evidence, telemetry, operator deadlines, ES|QL, project enrichment and room alerts. Findings and verification limits are recorded below.

| Finding | Correction | Evidence |
|---|---|---|
| Different eval cohorts could compare as a baseline | Require query/label/corpus/ranking identities | Python regression checks |
| Eval query semantics differed from runtime | Same lexical AND and RRF window; emitted request parity | Python-to-Node request comparison |
| Partial crowd results became live zero | Validate timeout, shards, buckets, counts and completeness | Transport/HTTP regressions |
| Metrics body unbounded | Limit streaming response to 64 KiB | Oversized valid-body regression |
| Debounce could mix pagination queries | Invalidate pagination immediately and bind to filters | UI state checks and real browser |
| Saved crowd signals stayed falsely current | Persist only unknown observations; refresh from current responses | Reload fixture and state checks |
| Search/detail/Plan B hid actual mode | Response-specific mode/degradation/reason | Browser fixture and UI checks |
| Cross-tab controls and removed dialog focus stale | Reconcile all controls; connected focus fallback | Native browser tabs and keyboard |
| Partial subscriptions returned no-alert | Require complete exact search, else unavailable | Empty/nonempty partial HTTP regressions |
| Mode change could skip pagination rows | Offset-zero replacement and result-set mode ceiling | Six browser transition assertions, backend and UI tests |
| Healthy telemetry lacked an error series | Zero-fill only numerator; require positive real total | Primary semantics and query-boundary fixtures |

Additional delivery findings:

| Finding | Correction | Evidence |
|---|---|---|
| Ranking failure lost known-full exclusions | Retain validated crowd observations through snapshot fallback | Real HTTP adapter regression and scoped re-review |
| Fresh CI could evaluate an old index against changed source | Match actual corpus identity to the checked-out catalog | Red/green Python regression and scoped re-review |
| Browser/backend telemetry leaked stable URL query attributes | Scrub stable and legacy attributes; inspect actual combined exports | Real local collector and scoped review |
| Slow HTTP headers could evade socket timeout | Owned request process with wall deadline and cleanup | Real slow-header regression and scoped re-review |
| Project enrichment might overwrite schedule facts | Preserve all original fields/tags; match only conservative exact project names | Independent470-record before/after and520-mention source audit |
| ES\|QL might return partial or incompatible observations | Typed complete-result validation and a bounded aggregation fallback |25 ES\|QL cases and independent query/API review |

Final alert reviews closed durable-warning, stale-signal, pause/ack race and polling-focus findings. The Plan B coverage review closed misleading crowd-outage copy when only topic matching broadened. Scoped final reviews report no remaining Important/Critical finding; root independently ran integrated suites and 17 browser scenarios.

The review did not establish remote service access, deployed state, real relevance metrics, container build success, or human acceptance. Those remain separate evidence requirements in `evidence-status.md`.
