# Radar AI SRE track starter: Cloud Native Hackathon

Start here if your team has its own cluster at the hackathon: a virtual Kubernetes cluster (vcluster) where you're cluster-admin. You get a small app that `git push` deploys through Argo CD, and notes your coding agent reads so it ships through [Radar](https://radarhq.io)'s MCP server. Below is a menu of what Radar can do: pick what your project needs.

## The day

- 11:00: before you write any code, get your cluster, open it in Radar Cloud, and connect your agent to Radar (steps below).
- First hour: open **Checks** for your cluster and take a screenshot. That's your "before".
- All day, work through Radar: your agent pushes, syncs and waits for each rollout through Radar's MCP. When something breaks, look in Radar first, and start an AI investigation on anything you can't explain.
- By 5:30: tell the day's story from Radar: the timeline, the investigation, and Checks before and after. It's only there if you used Radar all day.
- The winning team gets $4,000. Hackathon clusters and access to the hackathon org end on Friday, November 13.

## Before you start

Get your team's cluster at **join.cnh.radarhq.io** (the join code is shared at the kickoff and on the Radar table). It takes 3 to 4 minutes; `join.cnh.radarhq.io/status/<team-name>` shows the progress and says when it's ready. Then you have:

- your own cluster, named `<team-name>` in Radar Cloud,
- this starter app already running in it, in namespace `team-<team-name>`, at `https://<team-name>.cnh.radarhq.io`,
- an invite for each of you to the hackathon's organization in Radar Cloud. Accept it and sign in at [app.radarhq.io](https://app.radarhq.io).

Every team is in the same Radar Cloud organization, so Radar Cloud lists every team's cluster, each under its team's name, plus `cnh`, the platform's own cluster. You only have access to your own team's cluster. The member list, with emails, and any investigation you mark **Shared** are visible to every team. Investigations start private; keep them that way unless you mean to show every team. Alert notifications are off for the event, because they would go to everyone.

## Connect your agent

In Radar Cloud, open **Agents** and pick your client. For Claude Code:

```bash
claude mcp add radar-cloud --transport http https://api.radarhq.io/mcp
```

It signs you in through your browser the first time. If you're in more than one Radar Cloud organization, pick **Cloud Native Hackathon** under "Organization access" on that page. Then give it a first prompt:

> Read AGENTS.md, find our team's cluster in Radar, and tell me what's running in our namespace. Don't change anything yet.

Every Radar MCP tool takes a `cluster` id, and your agent must pass yours on every call: the organization has about 40 clusters. AGENTS.md tells it how to find the id.

This repo also has skills for shipping, debugging and canaries in `.agents/skills/`. Claude Code and Codex pick them up on their own.

## Ship your own code

1. **Make your copy.** Click **Use this template** > **Create a new repository**. Make it **public**, because Argo CD in your cluster reads it without credentials. Clone it.
2. **Point it at your team.**
   ```bash
   ./scripts/setup.sh <team-name>
   git commit -am "Set up team <team-name>" && git pull --rebase && git push
   ```
   The `git pull` picks up a commit the Action may already have made when GitHub created your repo. The Action builds the image and pushes it to GHCR. Wait for it to go green (the repo's **Actions** tab).
3. **Check the image is public.** On your repo's GitHub page, open **Packages** (right-hand column) and your image: it should say **Public**, and usually already does. If it says **Private**, open **Package settings** > **Change visibility** > **Public**, because your cluster can't pull a private image.
4. **Start GitOps.** Ask your agent to apply `argocd/application.yaml` to your cluster through Radar's MCP server. Argo CD takes over the starter app and from then on deploys every push to `main`.
5. **Check it's yours.** Open `https://<team-name>.cnh.radarhq.io`. It shows `version` and the first 7 characters of your latest commit.

One person can do this while the others accept their invites.

## What Radar can do for you

Pick what your project needs. None of it is required, and more doesn't score higher.

| You want to | In Radar Cloud | Or ask your agent |
|---|---|---|
| See what's running and how it connects | Topology, Resources | "Show me what our app talks to and depends on." |
| Ship every push and know it worked | GitOps, the Application's page | "Ship this, and tell me when it's healthy and live." |
| Find what's broken right now | Issues, the workload's Timeline and Logs | "What's unhealthy in our cluster, and why?" |
| See what changed | Timeline, with diffs | "What changed in the last hour?" |
| Trace a failure to its cause | **Investigate** on the failing resource | You start this one in Radar Cloud. |
| Check health and security | Checks | "Review Checks for our namespace and fix what applies." |
| See load and resource use over time | The workload's Metrics tab | "Is our memory climbing? Are our requests sized right?" |
| Add a database or an operator | Helm | "Install CloudNativePG and a small Postgres for us." |
| Restart, scale or run a job | The workload's page | "Restart the app." "Run the cronjob now." |
| Release carefully, or autoscale | The Rollout's page: Promote, Abort | "Switch us to canary releases" (`examples/canary`), or "Add autoscaling" (`examples/hpa`). |

Replace `app/` with your own project whenever you like. Keep it listening on `$PORT` (8080) with `/healthz` and `/readyz`, or update the probes in `deploy/`.

## What the judges look for

1. Run your project on Kubernetes with Radar connected, in the cluster we provide your team or on a cluster you bring.
2. Use Radar's UI and MCP throughout building and operating your project. Show how Radar helped you ship, troubleshoot, or improve your app.
3. Use Radar's AI investigations to investigate a real issue or question about your running app. Show what you learned and what you did with the findings.
4. Build something that makes conferences easier.

One real decision Radar helped you make is enough. More features don't score higher, and don't break things on purpose for the demo. Official wording: [hackathon page](https://www.wemakedevs.org/hackathons/cnh).

## Your cluster

Already installed: Argo CD in namespace `argocd`, Argo Rollouts, the Gateway API CRDs, metrics for `kubectl top` and the HPA, and Prometheus in namespace `monitoring`. Argo CD has no web UI here: see and sync your Applications in Radar Cloud, or through your agent. It picks up Applications in `team-*` namespaces, and your Argo CD project is `team-<team-name>`.

**Metrics history.** Prometheus (`monitoring/prometheus-server`) scrapes your pods' CPU, memory and network, the kubelet, kube-state-metrics, and any pod or Service annotated `prometheus.io/scrape: "true"` (plus `prometheus.io/port` and `prometheus.io/path` if it isn't `/metrics`), every 30 seconds, and keeps 7 days. Radar finds it on its own: workloads get metric charts in Radar Cloud, and your agent can call `discover_metrics` to see what's there and `query_prometheus` to run PromQL. It doesn't count against your budget. It sees only your cluster. There's no node-exporter (the host refuses it) and no Alertmanager.

**Your URL.** The platform routes `https://<team-name>.cnh.radarhq.io` to Service `app`, port 80, in namespace `team-<team-name>`. Keep a Service by that name and port there, whatever runs behind it. You can't get other hostnames, and Services of type LoadBalancer or NodePort aren't available. The HTTPRoute in `deploy/` does nothing inside your cluster (there's no Gateway in it), and Argo CD counts it healthy, so leave it.

**Install what you need.** You're cluster-admin, so CRDs, operators, Helm charts and more namespaces are all fine. For example, with [kubectl access](#kubectl), the CloudNativePG operator for Postgres:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm upgrade --install cnpg cnpg/cloudnative-pg --namespace cnpg-system --create-namespace
```

Or ask your agent to apply an operator's manifest with Radar's `apply_resource`, or to keep it in git as another Argo CD Application in `team-<team-name>`: your project `team-<team-name>` takes any source repo, any namespace in your cluster, and cluster-scoped resources.

**What the host refuses.** Privileged pods, and pods that use hostPath, hostNetwork or hostPID. Such a pod stays `Pending`, and its reason is a Warning event `SyncError` on the pod: you see it in Radar's events, and your agent through `get_events` or `diagnose`. Charts for node agents (log collectors, node exporters, storage drivers) often ask for these; turn that part off or pick another chart.

**Budget.** One total for everything you run, in any namespace, including what you install: 2 CPU and 4 GiB of requests, 4 CPU and 8 GiB of limits, and 4 PVCs with 20 GiB of storage (the default StorageClass is gp3). Containers without their own requests and limits get 100m CPU / 128Mi of requests and 500m / 512Mi of limits, so charts that set none still run. A pod that would go over stays `Pending` with a `SyncError` event that says `exceeded quota: team-quota`.

## kubectl

Radar is the main way in, but kubectl and helm work too. Your cluster's kubeconfig is in Secret `kubeconfig` in namespace `default`, key `config`:

1. In Radar Cloud, open your cluster, then **Resources** > **Secrets** (under Configuration), and open `kubeconfig` in namespace `default`.
2. Under **Data**, click **Reveal** next to `config`, then the copy icon that appears beside it ("Copy value"). Don't do this while sharing your screen.
3. Save it to a file outside your repo (the repo is public, and anyone with this file is cluster-admin in your cluster), and use it:
   ```bash
   export KUBECONFIG=~/cnh-kubeconfig
   kubectl get pods -n team-<team-name>
   ```

It talks to `https://<team-name>.vc.cnh.radarhq.io`. Its token lasts 24 hours and the platform replaces it about every 12 hours, so a fresh copy is good for at least 12 hours. If kubectl says `Unauthorized`, copy it again.

## When something's wrong

- **Your agent can't find your cluster.** Check that you accepted the invite with an email your team listed when it joined, and that you picked **Cloud Native Hackathon** under "Organization access" when you connected the MCP server. Your cluster is named exactly `<team-name>`.
- **A pod stays `Pending`.** Read its events in Radar. A `SyncError` means the host refused it (see [Your cluster](#your-cluster)): `exceeded quota: team-quota` means you're over your budget; otherwise it asks for privileged or host access.
- **The URL answers 404 or 503 while your pods are healthy.** Check Service `app` in `team-<team-name>`: port 80, and a selector that matches your ready pods.
- **kubectl says `Unauthorized`.** The token expired. Copy `config` again.
- **Radar Cloud is down.** Run Radar on your laptop with your kubeconfig (copy it early, so you have one):
  ```bash
  curl -fsSL https://get.radarhq.io | sh
  kubectl radar --kubeconfig ~/cnh-kubeconfig
  ```
  Its MCP server is `http://localhost:9280/mcp`. For Claude Code: `claude mcp add radar-local --transport http http://localhost:9280/mcp`. It sees only your cluster, so its tools take no `cluster`.

## Bringing a cluster of your own instead

The same repo works on a cluster you bring (kind, k3d, minikube or a cloud cluster) with Argo CD installed, and Argo Rollouts if you use `examples/canary`:

1. Connect the cluster to your own free Radar Cloud organization: sign up at [app.radarhq.io](https://app.radarhq.io), click **Connect a cluster**, and run the Helm command it gives you.
2. Run `./scripts/setup.sh <team-name>`, then delete the `- httproute.yaml` line from `deploy/kustomization.yaml` (it points at the hackathon's gateway). Push.
3. Apply `argocd/application-byo.yaml` instead of `argocd/application.yaml`: it uses Argo CD's `default` project and creates the namespace.
4. Reach the app with Radar's port-forward, or `kubectl -n team-<team-name> port-forward svc/app 8080:80`.

## After today

Connect your own cluster to Radar Cloud. Hackathon participants get 3 months of Enterprise free: tell us your org name at the Radar table or in reply to our follow-up email, by Nov 30. Or run open-source Radar (`brew install kubectl-radar`), and star [skyhook-io/radar](https://github.com/skyhook-io/radar) if it helped.

## Help

Find Roy, Nadav or Arlen at the Radar table, or ask in `#cnh-hackathon` on the [Radar Discord](https://radarhq.io/community/chat).
