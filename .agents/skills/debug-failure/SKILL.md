---
name: debug-failure
description: Find the root cause of a failure in this team's namespace on the hackathon cluster and fix it in git. Use when the app is down, slow, crash-looping, not updating, returning errors, or a deploy or Argo CD sync failed.
---

# Debug a failure, fix it in git

Work from evidence: read what Radar shows, name the cause, then change the repo. The cluster reverts direct edits (Argo CD self-heal), so every fix ships as a commit.

The namespace is `team-<team>`, from `namespace:` in `deploy/kustomization.yaml`. Pass it to every Radar MCP call.

## 1. Stop the damage first

- **Canary paused or crash-looping** (`deploy/` uses `rollout.yaml`): call `manage_rollout` with `action: abort`. The stable version takes all traffic back at once. The next pushed version starts a fresh canary.
- **Plain Deployment broken after a push**: the rollback is `git revert <bad commit>` and a push. Don't use `manage_gitops` rollback: auto-sync puts `main` back.

Tell the person what you did before you go deeper.

## 2. Gather evidence

1. Call `issues` for the namespace. It lists what's broken now, grouped and with a reason.
2. Call `get_changes` for the namespace, `since: 1h`, to see what changed just before it broke. Image, env and probe diffs are listed first.
3. Call `diagnose` on the failing workload: `kind: deployment`, or `kind: rollout` with `group: argoproj.io`, and `name: app`. You get logs, events and startup blockers in one call. For a sync problem, diagnose `kind: application` with `group: argoproj.io`.
4. If you need more:
   - `get_pod_logs` with `previous: true` gives the crash's own output;
   - `get_events` covers scheduling and quota;
   - `get_resource` on the Application (`status.conditions`, `status.operationState`) covers sync errors.

## 3. Common causes on this cluster

| Symptom | Usual cause | Fix |
| --- | --- | --- |
| `ImagePullBackOff`, 401/403/denied | The GHCR package is still private | The person makes it public: repo > Packages > Package settings > Change visibility |
| `ImagePullBackOff`, not found | The tag wasn't built (the Action failed) | `gh run view --log-failed`, fix the build |
| `OOMKilled`, exit 137 | The container passed `limits.memory` | Fix the app's memory use, or raise the limit in `deploy/` (the namespace quota caps limits at 8 GiB) |
| `CrashLoopBackOff` | The app exits at startup | `get_pod_logs` with `previous: true` |
| Ready 0/N, readiness failing | The app isn't on `$PORT` (8080), or `/readyz` doesn't answer 200 | Fix the app, or the probe paths in `deploy/` |
| Pods `Pending`, `exceeded quota` | Requests are over the namespace quota (2 CPU, 4 GiB) | Lower `replicas` or `requests` |
| Admission denied (`Bare Pods`, `node pool`, `hostname`) | A cluster rule | Use a Deployment or Job; don't set nodeSelector or nodeName; routes must use `<team>.cnh.radarhq.io` |
| Old version still serving | Argo CD hasn't synced, or the sync failed | The `ship` skill, steps 2 and 3 |
| URL 404 or 503, pods healthy | HTTPRoute missing, rejected or pointing at the wrong Service | `diagnose` the route (`kind: httproute`) with `probe: true` |

## 4. Fix, ship, confirm

Make the smallest change that removes the cause, push it, and follow the `ship` skill to the end, including step 5: the URL must show the fixed commit's version, not just answer 200. Confirm `issues` no longer lists the problem.

## 5. When it's not obvious

Suggest the person start an AI investigation in Radar Cloud: open the failing resource at app.radarhq.io and click Investigate. It traces the failure to a root cause with evidence and changes nothing. Investigations are private unless the person shares them, and sharing shows them to every team in the org.

## Report

Give the person three things: the cause, with the evidence that shows it; the commit that fixed it; and what you checked to confirm it's fixed.
