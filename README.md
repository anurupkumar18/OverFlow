# Radar AI SRE track starter: Cloud Native Hackathon

Start here if your team has a namespace on the hackathon cluster. You get a small app that `git push` deploys through Argo CD, an autoscaler and a canary ready to turn on, and notes your coding agent reads so it ships through [Radar](https://radarhq.io)'s MCP server.

## Before you start

Get your team's namespace at **join.cnh.radarhq.io** (the join code is on the Radar table and in the organizers' email), or at the Radar table. Within a minute you have:

- the namespace `team-<team-name>` on the hackathon cluster,
- this starter app already running at `https://<team-name>.cnh.radarhq.io`,
- an invite for each of you to the hackathon's organization in Radar Cloud. Accept it and sign in at [app.radarhq.io](https://app.radarhq.io).

Every team is in the same Radar Cloud organization. You see and change only your own namespace, but everyone in the org can see the member list (with emails) and any investigation you mark **Shared**. Investigations start private; keep them that way unless you mean to show every team.

## Connect your agent

In Radar Cloud, open **Agents** and pick your client. For Claude Code:

```bash
claude mcp add radar-cloud --transport http https://api.radarhq.io/mcp
```

It signs you in through your browser the first time. If you're in more than one Radar Cloud organization, pick **Cloud Native Hackathon** under "Organization access" on that page. Ask it what's running in `team-<team-name>`.

## Ship your own code

1. **Make your copy.** Click **Use this template** > **Create a new repository**. Make it **public**, because Argo CD on the cluster reads it without credentials. Clone it.
2. **Point it at your namespace.**
   ```bash
   ./scripts/setup.sh <team-name>
   git commit -am "Set up team <team-name>" && git push
   ```
   The GitHub Action builds the image and pushes it to GHCR.
3. **Make the image public, once.** On your repo's GitHub page, open **Packages** (right-hand column) > **Package settings** > **Change visibility** > **Public**. GHCR makes new images private, and the cluster can't pull a private one.
4. **Start GitOps.** Ask your agent to apply `argocd/application.yaml` through Radar's MCP server. Argo CD takes over the starter app and from then on deploys every push to `main`.

## Optional extras

Pick one if it fits your project. Neither is required.

- `examples/hpa`: autoscaling.
- `examples/canary`: ship every change as an Argo Rollouts canary and promote it through Radar.

[`JUDGING.md`](JUDGING.md) says what the judges look for, with examples of showing what Radar did for your project.

Replace `app/` with your own project whenever you like. Keep it listening on `$PORT` (8080) with `/healthz` and `/readyz`, or update the probes in `deploy/`.

## What's on the cluster

Argo CD (Applications in your namespace, project `team-<team-name>`), Argo Rollouts, metrics-server, and a gateway that serves `https://<team-name>.cnh.radarhq.io` with TLS. Your namespace has a quota of 2 CPU and 4 GiB of requests and 4 CPU and 8 GiB of limits, and containers without their own requests and limits get small defaults.

## Bringing your own cluster instead

The same repo works on your own cluster (kind, k3d, minikube or a cloud cluster) with Argo CD installed, and Argo Rollouts if you use `examples/canary`:

1. Connect the cluster to your own free Radar Cloud organization: sign up at [app.radarhq.io/signup](https://app.radarhq.io/signup), click **Connect a cluster**, and run the Helm command it gives you.
2. Run `./scripts/setup.sh <team-name>`, then delete the `- httproute.yaml` line from `deploy/kustomization.yaml` (it points at the hackathon's gateway). Push.
3. Apply `argocd/application-byo.yaml` instead of `argocd/application.yaml`: it uses Argo CD's `default` project and creates the namespace.
4. Reach the app with Radar's port-forward, or `kubectl -n team-<team-name> port-forward svc/app 8080:80`.

## Help

Find Roy, Nadav or Arlen at the Radar table, or ask in the [Radar Discord](https://radarhq.io/community/chat).
