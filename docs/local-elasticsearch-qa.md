# Actual local Elasticsearch verification

On November 8, 2026, an isolated Elasticsearch 9.5.6 ARM runtime indexed all 470 records from the checked-in catalog. Root verified parsed source and record equality; raw hashes differ only in JSON serialization. The official vendor archive checksum was verified. It used the bundled JDK, basic license, 512 MiB heap, ML disabled, new disposable indices, public schedule data and synthetic interaction identities. HTTP/transport bound to loopback 19200/19300; a temporary Node 22 app bound to 18080. The normal 8080 preview was separate.

The mapping used repository lexical analysis, synonyms and properties, with `semantic_text` and its `copy_to` omitted because no inference model was activated. Built-in endpoint descriptors were not treated as working-model evidence. No cloud account, paid trial, global install or existing service changed.

## Observed results

All 12 final API scenarios passed: actual version/license and protected dependencies; BM25 search; complete 470-record pagination; nonempty MLT Plan B; idempotent bookmarks/reports; exact ES|QL and aggregation parity; smoke/old/future report exclusion; full-room exclusion; subscriptions/alerts; repeatable unbookmark; persistent admin mode and truthful higher-mode fallback. Separate checks verified the 199→200→199 estimated-capacity boundary, a strict nonempty alternative removed after two full reports, Denver day count 156 and matching 284-result `k8s`/`kubernetes` queries.

Strict MLT returned zero results for 11 of 12 sampled sources. The bounded broader-topic retry fixed source 1227395, returning 3 alternatives with an explicit broader-match reason and degraded status. After one alternative received two reports, it was excluded and 3 alternatives remained. Strict nonempty results retain their ranking. The wider 12-source post-fix sweep was not run. This is candidate coverage, not human relevance grading.

[Sanitized results](evidence/local-elasticsearch.json) record catalog hashes, IDs, counts and outcomes. Per-scenario elapsed times include writes/refresh waits and are not a latency benchmark. Disposable scripts/config/vendor files remain in the intermediate `work/local-elastic` folder, outside the source archive; the temporary admin env was deleted.

## Resource boundary

A critical host memory-pressure guard fired before the planned browser-on-real-Elasticsearch check. Only owned Elasticsearch and the 18080 app processes were stopped; ports and PIDs were verified clear. The 8080 preview remained. That initial run ended without a lower-heap retry. A later attempt is recorded below; vendor files remain dormant without autostart.

A complete browser workflow against real Elasticsearch, inference/rerank, production latency and all remote deployment claims remain unverified. Separate browser tests use the real snapshot app or explicitly simulated live APIs; those results are distinct from this database API evidence.

References: [official archive installation](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-from-archive-on-linux-macos), [MLT defaults](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-mlt-query). Runtime success does not assert support-contract certification for this host OS.

## Sequenced browser attempt at 23:02 UTC

After all owned QA browsers closed, memory was normal with 53% free. One new supervised run reused the same data and 512 MiB heap, with an eight-minute lifetime and checks every two seconds. Elasticsearch became ready at 23:02:21 UTC, with normal kernel pressure and 43% free. One isolated Chrome context was opened, without API interception or fake clocks.

The browser loaded the app and facets, and one actual initial browse returned BM25 with `degraded:false`. Opening Chrome then raised kernel memory pressure above normal. The supervisor stopped the owned database/app groups at 23:02:35 UTC; Elasticsearch closed by 23:02:37 UTC. The exact pressure level was not retained, so this second attempt is not labeled critical. The observed browser connection-loss state was expected after the shutdown.

Live watch/interest acknowledgments, actual 15-second polling, live Plan B and save/reload/ICS did not run in this attempt. Their earlier snapshot/fixture checks remain distinct. The wider post-fix sample was also not run. All owned temporary processes and Chrome closed, test ports were clear, and temporary credentials were deleted. Root independently verified the regular 8080 preview remained healthy. No further restart, heap adjustment or browser attempt followed.
