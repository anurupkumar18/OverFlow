# Notes for your coding agent

This repo deploys to this team's own Kubernetes cluster at the Cloud Native Hackathon: a virtual cluster (vcluster) that Radar Cloud lists as **`__TEAM__`**, where the team is cluster-admin. The app runs in namespace `team-__TEAM__`. Use Radar Cloud's MCP server (`radar-cloud`) for everything you observe or change on the cluster. Read each tool's schema; don't invent parameters.

**Pass `cluster` on every Radar call.** The organization has about 40 team clusters plus `cnh`, the platform's cluster, where teams have no access. Call `list_clusters` once per session, take the `id` of the entry whose `name` is exactly `__TEAM__`, and pass that id as `cluster` on every other Radar tool call. With this many clusters the tools can't pick a default. The person only has access to this team's cluster; never call a tool against `cnh` or another team's cluster. Pass `namespace: team-__TEAM__` wherever a tool takes it, unless you mean another namespace in this cluster.

Deploys are GitOps: change the repo, push to `main`, and Argo CD syncs the namespace. Argo CD runs inside this cluster (namespace `argocd`) with no web UI; you drive it with `manage_gitops`. Don't apply or patch app manifests on the cluster. Argo CD's self-heal puts the repo's version back. The one exception is `argocd/application.yaml`, applied once to start the sync.

## When to do what

- **First cluster access in a session.** Call `list_clusters`, find `__TEAM__`, and read the workloads in `team-__TEAM__` with its id. If no cluster is named `__TEAM__`, the person hasn't accepted the Radar Cloud invite, or picked a different organization when connecting. Ask them to pick **Cloud Native Hackathon** under "Organization access" (reconnect the MCP server). If it's there but your calls to it are refused, check that the person signed in with an email the team listed when it joined. If it's disconnected, or nothing here helps, ask an organizer at the Radar table. Don't go on until you can read the namespace.
- **After every push.** Wait for the GitHub Action and its `deploy: <sha> [skip ci]` commit. Sync or inspect the Argo CD Application through Radar, wait for the rollout, then check three things before saying it's deployed: the synced revision, workload health, and the URL showing the new version. Procedure: the `ship` skill.
- **A deploy or the app fails.** Read the evidence first: `issues`, `get_changes`, events, logs (`diagnose` bundles them). Name the cause, then fix it in git. A pod stuck `Pending` with a Warning event `SyncError` was refused by the host (see Limits). Procedure: the `debug-failure` skill.
- **A canary is paused.** That's a release decision, not a stuck wait. Stop waiting at the pause, check the canary pods and the URL, show the person what you saw, and promote or abort only when they say so, unless they already told you to. Procedure: the `canary-release` skill.
- **The project needs something cluster-wide** (an operator, CRDs, a Helm chart, another namespace). That's allowed. Check first that it needs no privileged or host access and fits the budget (see Limits), then install it: with `apply_resource`, with `helm` if the person has set up kubectl (README, kubectl), or as another Argo CD Application in namespace `team-__TEAM__`, project `team-__TEAM__` (it allows any source repo, any namespace in this cluster, and cluster-scoped resources). Tell the person what you installed. If an Application has `syncOptions` (`CreateNamespace=true` for a new namespace, say), pass the same options as `sync_options` on every `manage_gitops` sync (the `ship` skill, step 3).
- **The app needs a database.** Postgres comes from the CloudNativePG operator already in this cluster; don't install it again. Add a `postgresql.cnpg.io/v1` `Cluster` in `team-__TEAM__` to the repo so Argo CD applies it, or apply it with `apply_resource`. One instance with `storage.size: 1Gi` is plenty; each instance is a pod and a PVC from the team's budget. Wait for the Cluster's `Ready` condition, then point the app at Service `<name>-rw`, port 5432, with the credentials from Secret `<name>-app` (keys `username`, `password`, `uri`).
- **A question about resource use or load over time** (is memory climbing, did the canary use more CPU, what's the request rate). Prometheus runs in this cluster (`monitoring/prometheus-server`) and Radar queries it: call `discover_metrics` to see which metrics exist, then `query_prometheus` with PromQL, filtered to `namespace="team-__TEAM__"`. It has container CPU, memory and network (`container_*`), kube-state-metrics (`kube_*`), and anything the app exposes on `/metrics` with the annotation `prometheus.io/scrape: "true"`. For a point-in-time view, `top_resources` is enough.
- **How the app fits together** (what talks to what, what depends on what). `get_topology`, or `get_neighborhood` on one workload.
- **Day-to-day operations.** Restart with `manage_workload`, run a CronJob now with `manage_cronjob`, see installed charts with `list_helm_releases`. Change replica counts in git, not on the cluster: Argo CD's self-heal puts the repo's value back.
- **Once, before the demo.** Review Radar's Checks for this cluster (`get_cluster_audit`, namespace `team-__TEAM__` plus any namespace you added). Fix a finding that applies to this team's workloads, or say why it doesn't apply. Leave findings on the pre-installed Argo CD, Argo Rollouts, Prometheus, CloudNativePG operator and metrics components alone.
- **A real symptom you can't explain.** Suggest the person start an AI investigation in Radar Cloud: Investigate on the failing resource. It traces the failure to a cause with evidence and changes nothing. That's a separate hosted run; `diagnose` doesn't start it.
- **Radar Cloud is down.** The person can run Radar locally (README, "When something's wrong"). Its MCP server is `http://localhost:9280/mcp`; it sees only this cluster, so its tools take no `cluster`.

## Never

- Break things on purpose, or generate load you can't bound.
- Touch `cnh` or another team's cluster, or try to get around the host's limits (privileged, hostPath, hostNetwork or hostPID pods; the resource budget).
- Remove or reconfigure what came pre-installed: Argo CD, Argo Rollouts, Prometheus, the CloudNativePG operator, the metrics setup, the AppProject `team-__TEAM__`. GitOps, Radar's metrics and the team's databases depend on them.
- Write a kubeconfig or token into the repo, a commit, or your output. The repo is public.
- Poll forever. Each wait has a limit (`wait_for` waits up to 45 seconds per call). After about 5 minutes, report what's blocking instead of retrying.

## Skills

`.agents/skills/` has the three procedures named above: `ship`, `debug-failure` and `canary-release`. Claude Code and Codex load them as skills. If your agent doesn't, read the matching `SKILL.md` before that task.

## Limits

- Budget: one total across every namespace in this cluster, including anything you install: 2 CPU and 4 GiB of requests, 4 CPU and 8 GiB of limits, 4 PVCs and 20 GiB of storage (default StorageClass gp3). Containers without their own requests and limits get 100m / 128Mi of requests and 500m / 512Mi of limits. The starter pod's 500m CPU limit means 8 pods at most. A pod over the budget stays `Pending` with a `SyncError` event `exceeded quota: team-quota ...`.
- The host refuses privileged pods and pods with hostPath, hostNetwork or hostPID. Such a pod stays `Pending`; the reason is a Warning event `SyncError` on the pod (`get_events`, or `diagnose`).
- Your public URL is `https://__TEAM__.cnh.radarhq.io`. The platform routes it to Service `app`, port 80, in `team-__TEAM__`: keep that Service. No other hostname is possible, and Services of type LoadBalancer or NodePort aren't available. The HTTPRoute in `deploy/` does nothing in this cluster (it has no Gateway); Argo CD counts it healthy, so leave it.
- The app's image comes from GHCR and must be public.
- kubectl works only if the person copied the kubeconfig (README, kubectl). Prefer Radar's tools: they're what the track is about.
