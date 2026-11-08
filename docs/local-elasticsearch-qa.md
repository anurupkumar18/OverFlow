# Actual local Elasticsearch verification

On November8,2026, an isolated Elasticsearch9.5.6 ARM runtime indexed all470 records from the checked-in catalog. Root verified parsed source and record equality; raw hashes differ only in JSON serialization. The official vendor archive checksum was verified. It used the bundled JDK, basic license,512MiB heap, ML disabled, new disposable indices, public schedule data and synthetic interaction identities. HTTP/transport bound to loopback19200/19300; a temporary Node22 app bound to18080. The normal8080 preview was separate.

The mapping used repository lexical analysis, synonyms and properties, with `semantic_text` and its `copy_to` omitted because no inference model was activated. Built-in endpoint descriptors were not treated as working-model evidence. No cloud account, paid trial, global install or existing service changed.

## Observed results

All12 final API scenarios passed: actual version/license and protected dependencies; BM25 search; complete470-record pagination; nonempty MLT Plan B; idempotent bookmarks/reports; exact ES|QL and aggregation parity; smoke/old/future report exclusion; full-room exclusion; subscriptions/alerts; repeatable unbookmark; persistent admin mode and truthful higher-mode fallback. Separate checks verified the199→200→199 estimated-capacity boundary, a strict nonempty alternative removed after two full reports, Denver day count156 and matching284-result `k8s`/`kubernetes` queries.

Strict MLT returned zero results for11 of12 sampled sources. The bounded broader-topic retry fixed source1227395, returning3 alternatives with explicit broader-match reason and degraded status. After one alternative received two reports, it was excluded and3 alternatives remained. Strict nonempty results retain their ranking. The wider12-source post-fix sweep was not run. This is candidate coverage, not human relevance grading.

[Sanitized results](evidence/local-elasticsearch.json) record catalog hashes, IDs, counts and outcomes. Per-scenario elapsed times include writes/refresh waits and are not a latency benchmark. Disposable scripts/config/vendor files remain in the intermediate `work/local-elastic` folder, outside the source archive; the temporary admin env was deleted.

## Resource boundary

A critical host memory-pressure guard fired before the planned browser-on-real-Elasticsearch check. Only owned Elasticsearch and18080 app processes were stopped; ports and PIDs were verified clear. The8080 preview remained. No lower-heap retry or restart followed. Vendor files remain dormant without autostart.

Browser-on-real-Elasticsearch, inference/rerank, production latency and all remote deployment claims remain unverified. Separate browser tests use the real snapshot app or explicitly simulated live APIs; those results are distinct from this database API evidence.

References: [official archive installation](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-from-archive-on-linux-macos), [MLT defaults](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-mlt-query). Runtime success does not assert support-contract certification for this host OS.
