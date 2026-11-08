# Retrieval evaluation

No queries have been approved and no participant labels were supplied. `queries.json` is empty. `queries.suggested.json` contains **20 agent-drafted suggestions**, excluded from evaluation until the participant explicitly selects or supplies queries. `results.md` truthfully reports n=0 and not measured. No baseline or ranking winner is fabricated.

All commands run from repository root with Python 3.11+ and no third-party packages:

```sh
python3 -m unittest discover -s scripts/tests -v
python3 eval/pool.py
python3 eval/run.py
python3 eval/gate.py
```

After participant approval, `eval/queries.json` uses `[{"id":"q01","text":"participant-approved exact query"}]`. Preserve the participant's wording. Collect real rankings with:

```sh
python3 eval/pool.py --env /absolute/private/overflow.env
```

The script internally reads `ES_URL` and `ES_READ_KEY` (or `ES_API_KEY`) from the supplied private file. Never pass keys as command arguments or commit the file. It discovers an existing rerank endpoint via `GET /_inference`; `ES_RERANK_INFERENCE_ID` can pin one that actually exists. Endpoint tasks must be compatible. No endpoint is created automatically. Four arms run directly against `talks`: BM25, semantic, RRF hybrid, and hybrid with a top-20 reranker. Lexical `best_fields`/AND, RRF window100 (plus offset), constant60, filters, and reranker20 match runtime `buildSearch`; a cross-language test compares the actual request objects. Collector retains the top10 returned IDs. Unsupported/failed arms are recorded as errors rather than silently replaced. This is provider ranking evaluation, without app caches; it is not the production latency or fallback evaluation.

`runs.json` stores query IDs, returned talk IDs, real request elapsed time and status. `--runs /path/actual-runs.json` rebuilds a pool offline only when its query list exactly matches the approved list. Top **5 per arm** are deduplicated, deterministically shuffled per query, and grouped by query in `labels_todo.csv`. Arm and rank are hidden from the labeler.

The participant enters `label` 0 (not relevant), 1 (relevant) or 2 (highly relevant), and `label_source` **human** for each judged row. Leave all unjudged rows blank. Stop at any query boundary. Agent/synthetic labels are rejected; declaration cannot prove human authorship, so do not relabel generated scores as human. Fixture labels in tests demonstrate algorithm behavior and are never copied into measured results.

Metrics use only queries whose entire pool has human judgments, at least one judged relevant item, and successful runs for **all four arms**. Partial/unjudged queries, failed-arm queries, and pools without a relevant item are counted separately. Positives are labels 1 or 2. The same eligible query subset is used by every arm.

**Pooled Recall@10 is recall against known relevant documents in the top-5-per-arm pool, not corpus recall.** MRR is truncated at 10, retaining actual result positions; unjudged top-10 items remain unknown and are counted, never converted into label 0. MRR can therefore be a lower bound relative to complete judgments. These limited judgments do not establish the best result in the entire catalog. Client p95 uses nearest-rank on one real sample per eligible query/arm; sample size is shown and small n is unreliable. No Dash0/provider latency is invented.

`gate.py` recomputes metrics from runs and labels. Without genuine nonempty human-labeled results or a participant-approved measured baseline it prints `status:not_evaluated`, never `passed`. Its default exit 0 makes this an informational CI report; `--require-evaluated` exits 2 when evidence is absent. A measured MRR drop greater than 0.05 exits 1. No `baseline.json` exists initially. A future approved baseline must record `arm`, measured `mrr`, positive `n`, `label_source:human`, `approved:true`, and copy `eligible_query_ids` plus the complete `evidence` object from its reviewed measured result. Exact eligible cohort/n, query wording, human labels, actual indexed corpus and ranking-configuration fingerprints must match the current result; missing or changed identities report **not_evaluated**, never a regression pass across incomparable cohorts.

For real collections, the collector fingerprints up to1000 actual indexed documents (excluding derived semantic_text), mappings, index settings, synonym-set contents, existing inference configuration and request bodies both before and after collection. Only equal complete before/after evidence is recorded. Missing metadata access, a larger corpus, or observed drift leaves evidence absent and the regression gate not evaluated. Extra read privileges include index metadata and the synonym-set read API; do not expand a key silently. Hashes alone are not proof of real execution; preserve original provider-run evidence and human approval. Real provider access and cloud writes remain **unverified** in this build.

## Elasticsearch ingestion

```sh
python3 -m scripts.ingest.elastic --env /absolute/private/overflow.env
python3 -m scripts.ingest.elastic --env /absolute/private/overflow.env --apply
```

The first command is read-only inference discovery and index-plan summary. `--apply` explicitly creates the synonyms set and missing `talks`, `interactions`, `talk_alerts`, `overflow_settings` indices, then upserts talks in bounded batches and verifies count parity. Existing data is never deleted; stale IDs or incompatible inference mappings cause failure and require explicit migration. It reads `ES_ADMIN_KEY` or `ES_API_KEY` internally; raw responses and credentials are never printed. An HTTPS endpoint is required except loopback development. Redirects are refused.

Mappings pin a discovered embedding endpoint to `semantic_text`, fed by title/abstract/speakers through `copy_to`, with keyword facets, UTC date fields and searchable synonyms. No runtime default is silently installed. Polling subscriptions are supported; a percolator query field is reserved but this tooling does not claim a working alert dispatch mechanism. Scoped setup credentials need privileges to create/manage these four indices, write/read their documents, `monitor_inference`, and `manage_search_synonyms`; no key creation is performed here.

Primary API references: [semantic_text ingestion](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-ingestions), [semantic_text setup](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-setup-configuration), [RRF](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever), [reranker](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/text-similarity-reranker-retriever), [synonyms](https://www.elastic.co/docs/solutions/search/full-text/create-update-synonyms-api-example), [inference endpoints](https://www.elastic.co/docs/api/doc/elasticsearch/v8/operation/operation-inference-get). Consulted November 8, 2026; these APIs require a compatible provider version/license and actual cloud verification.
