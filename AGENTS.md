# Notes for your coding agent

This repo deploys to one namespace, `team-__TEAM__`, on the Cloud Native Hackathon's shared Kubernetes cluster. You operate it through Radar Cloud's MCP server (`radar-cloud`). There is no kubeconfig; Radar is the way into the cluster, and it acts as the signed-in person, so it can only see and change this team's namespace.

## How changes ship

- Deploys are GitOps. Change the files in `deploy/`, commit and push to `main`. The GitHub Action builds the image and commits the new tag; Argo CD syncs the namespace to the repo.
- Don't apply app manifests straight to the cluster. Argo CD's self-heal puts the repo's version back. The one exception is `argocd/application.yaml`, which is applied once (`apply_resource`) to start the sync.
- After a push, wait for the sync and the rollout instead of guessing: `manage_gitops` shows and syncs the Argo CD Application, and `wait_for` waits for a rollout to finish.

## Radar MCP tools worth knowing

| Task | Tool |
| --- | --- |
| What's broken right now | `issues` |
| Inspect a resource, its events, its logs | `get_resource`, `get_events`, `get_workload_logs`, `get_pod_logs` |
| What changed recently | `get_changes` |
| Best-practice findings (Radar's Checks) | `get_cluster_audit` |
| Sync or inspect the Argo CD Application | `manage_gitops` |
| Promote or abort an Argo Rollouts canary | `manage_rollout` |
| Restart or scale a workload | `manage_workload` |
| Wait for a rollout or sync to finish | `wait_for` |
| Find the root cause of a failure | `diagnose` |

## When something breaks

Start with `issues` and `get_changes` for this namespace, read the evidence, and fix it in git. For a deeper look, start an AI investigation in Radar Cloud (Investigate on the failing resource). It traces the failure to a root cause and shows the evidence for each finding; it doesn't change anything, so you apply the fix.

## Limits

- Quota for the namespace: 2 CPU and 4 GiB of requests, 4 CPU and 8 GiB of limits. Containers without their own requests and limits get small defaults.
- Your public URL is `https://__TEAM__.cnh.radarhq.io`. The HTTPRoute can only claim that hostname.
- Images come from GHCR and must be public.
