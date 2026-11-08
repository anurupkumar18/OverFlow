# Retrieval evaluation

Human-judged eligible queries: **n=0**.

| Arm | Pooled Recall@10 | MRR@10 | Client p95 ms | Latency n | Unjudged top-10 items |
|---|---:|---:|---:|---:|---:|
| bm25 | not measured | not measured | not measured | 0 | 0 |
| semantic | not measured | not measured | not measured | 0 | 0 |
| hybrid | not measured | not measured | not measured | 0 | 0 |
| hybrid_rerank | not measured | not measured | not measured | 0 | 0 |

Recall@10 uses relevant documents in the top-5-per-arm judged pool, not corpus-wide recall. MRR is truncated at 10 and uses judged relevant items; unjudged results stay unknown. Complete human query pools and successful runs for all four arms are required; queries with no judged relevant items are excluded. Latency is client-observed per request, nearest-rank p95 on included queries only.

Excluded incomplete query pools: 0.
Excluded queries with unavailable arms: 0.
Excluded fully judged pools with no relevant item: 0.

No deployment mode is selected automatically. No baseline is fabricated. Provider spans and production p95 are not measured by this script.
