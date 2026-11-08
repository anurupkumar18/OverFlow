---
title: Measured ranking changes
type: check
when: PR changes ranking, filters, app/data, scripts/ingest or eval
actions: Report missing fresh evaluation and apply needs-eval until evidence is complete
---

Require fresh provider runs on approved queries and real human judgments, with eligible n, per-arm MRR/pooled Recall@10/latency and a comparable approved baseline. Require the fresh-ranking CI result on the current revision. Never approve a missing-label result or a stale saved run as measured success. Do not add or alter human labels automatically. Explain a changed/incomparable corpus or query cohort instead of comparing its score silently.
