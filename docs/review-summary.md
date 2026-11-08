# Independent review summary

Three independent task reviewers and one fresh whole-branch reviewer inspected this build. Each fix wave was re-reviewed. Final local-build verdict: no remaining Important/Critical finding from the reviewed changes.

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

The review did not establish remote service access, deployed state, real relevance metrics, container build success, or human acceptance. Those remain separate evidence requirements in `evidence-status.md`.
