# Operator commands and release evidence

Run these commands from the repository root with Python 3.10+. They use only the standard library. An explicit app URL is always required. HTTPS is required except `localhost`, `127.0.0.1`, or `::1`; embedded credentials, query strings and redirects are refused. Do not pass tokens as command arguments.

## Read-only smoke

```sh
python3 scripts/smoke.py http://127.0.0.1:8080
python3 scripts/smoke.py http://127.0.0.1:8080 --expect-version dev
```

The default smoke never writes data or reads a private file. It checks the app document, health/readiness probes, configuration, search, one Plan B sample and service status. Config, probes, status and all search responses must report the same version; `--expect-version` additionally requires that exact `APP_VERSION` rather than accepting any consistent build. Supply the served short SHA if the build sets a short SHA.

Snapshot search and an explicit unavailable service status can pass this local check. Unknown status values must be null; available values must be finite and within their documented ranges. An empty Plan B response can be legitimate and is reported with `plan_b_nonempty_verified: false`, so it does not prove the nonempty alternatives flow. The reported p95 comes from ten sequential read-only search requests, not a production load benchmark.

## Protected dependency and live checks

Create a private file outside the repository containing `ADMIN_TOKEN` through your normal credential-management workflow. The commands read this file internally using the existing env parser, without executing shell text. They do not print its values. The token is sent only to `/api/deps` during smoke; public reads do not receive it.

```sh
python3 scripts/smoke.py https://your-owned-app.example --expect-version abc1234 --env /absolute/private/overflow.env
python3 scripts/smoke.py https://your-owned-app.example --expect-version abc1234 --env /absolute/private/overflow.env --require-live
```

With `--env`, the report includes the protected dependency result. `--require-live` requires both an explicit expected version and private file. It fails for snapshot/degraded search or Plan B, disabled live interactions, unavailable metrics, or unverified Elasticsearch/telemetry dependencies. The report does not include credentials or provider response bodies. Failures use fixed reason codes and a nonzero exit status.

Each HTTP request runs in an owned, short-lived Python process under a ten-second wall-clock deadline covering DNS, connect, response headers and body. A timeout kills and reaps that process before returning, closing its socket; it cannot be extended by a peer slowly dripping headers or body bytes. No process-global alarm, socket default or abandoned background thread is used. Request data and the token travel over a private stdin pipe, never command arguments or environment variables; internal output is bounded and is not logged. Request metadata is limited to 65,536 bytes, and response bodies to 2,000,000 bytes (65,536 bytes for internal command/dependency responses).

No automatic retries or unbounded polling occur. There is one initial search plus ten measured searches, one sampled Plan B request, and a fixed set of read-only checks. Smoke timings include Python process startup and isolation overhead, so they are tool observations rather than service latency measurements.

This command does **not** prove an Argo CD revision, workload image or rollout health, and cannot establish Dash0 trace/log/RUM correlation, container build success, ranking quality or competition eligibility. Before claiming deployed, separately verify the synced Git revision, healthy workload using the intended image, and public URL serving the intended version. A local `passed` report is not a deployed claim.

## Explicit ranking-mode write

```sh
python3 scripts/admin.py https://your-owned-app.example hybrid --env /absolute/private/overflow.env
```

Only this explicit command performs a write: `POST /api/admin/mode` with the supplied `ADMIN_TOKEN` as a Bearer header. Valid modes are `bm25`, `hybrid`, and `hybrid_rerank`. Success requires an acknowledgement of the exact requested mode. It means the setting write was accepted; it does not prove that inference/reranking subsequently executed. Inspect a fresh search response's actual mode and degradation after a change.

A timeout leaves the write outcome unknown: the server may have accepted it before the response was interrupted. The command never retries a write automatically; inspect the actual setting/search behavior before deciding to retry.

The runtime reads its setting with a ten-second cache. Selecting `hybrid_rerank` also requires a real compatible `ES_RERANK_INFERENCE_ID` in the server environment. An unavailable dependency may still cause visible fallback. No default mode, credential, repository or deployment destination is guessed by these commands.
