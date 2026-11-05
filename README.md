# Radar AI SRE track starter: Cloud Native Hackathon

Start here if your team has a namespace on the hackathon cluster. You get a small app that `git push` deploys through Argo CD, and notes your coding agent reads so it ships through [Radar](https://radarhq.io)'s MCP server. Autoscaling and canary examples are there if you want them.

## Before you start

Get your team's namespace at **join.cnh.radarhq.io** (the join code is on the Radar table and in the organizers' email), or at the Radar table. Within a minute you have:

- the namespace `team-<team-name>` on the hackathon cluster,
- this starter app already running at `https://<team-name>.cnh.radarhq.io`,
- an invite for each of you to the hackathon's organization in Radar Cloud. Accept it and sign in at [app.radarhq.io](https://app.radarhq.io).

Every team is in the same Radar Cloud organization. Your cluster access (resources, logs, Issues, the timeline, your agent's MCP calls) covers only your own namespace. Two things are org-wide: the member list, with emails, and any investigation you mark **Shared**. Investigations start private; keep them that way unless you mean to show every team. Alert notifications are off for the event, because they would go to everyone.

## Connect your agent

In Radar Cloud, open **Agents** and pick your client. For Claude Code:

```bash
claude mcp add radar-cloud --transport http https://api.radarhq.io/mcp
```

It signs you in through your browser the first time. If you're in more than one Radar Cloud organization, pick **Cloud Native Hackathon** under "Organization access" on that page. Then give it a first prompt:

> Read AGENTS.md, check that you can reach our namespace through Radar, and tell me what's running. Don't change anything yet.

This repo also has skills for shipping, debugging and canaries in `.agents/skills/`. Claude Code and Codex pick them up on their own.

## Ship your own code

1. **Make your copy.** Click **Use this template** > **Create a new repository**. Make it **public**, because Argo CD on the cluster reads it without credentials. Clone it.
2. **Point it at your namespace.**
   ```bash
   ./scripts/setup.sh <team-name>
   git commit -am "Set up team <team-name>" && git pull --rebase && git push
   ```
   The `git pull` picks up a commit the Action may already have made when GitHub created your repo. The Action builds the image and pushes it to GHCR. Wait for it to go green (the repo's **Actions** tab).
3. **Make the image public, once.** On your repo's GitHub page, open **Packages** (right-hand column) > **Package settings** > **Change visibility** > **Public**. GHCR makes new images private, and the cluster can't pull a private one.
4. **Start GitOps.** Ask your agent to apply `argocd/application.yaml` through Radar's MCP server. Argo CD takes over the starter app and from then on deploys every push to `main`.
5. **Check it's yours.** Open `https://<team-name>.cnh.radarhq.io`. It shows `version` and the first 7 characters of your latest commit.

One person can do this while the others accept their invites.

## Optional extras

Pick one if it fits your project. Neither is required.

- `examples/hpa`: autoscaling.
- `examples/canary`: ship every change as an Argo Rollouts canary and promote it through Radar.

Replace `app/` with your own project whenever you like. Keep it listening on `$PORT` (8080) with `/healthz` and `/readyz`, or update the probes in `deploy/`.

## What the judges look for

1. Run your project on Kubernetes with Radar connected, in the namespace we provide your team or on your own cluster.
2. Use Radar's UI and MCP throughout building and operating your project. Show how Radar helped you ship, troubleshoot, or improve your app.
3. Use Radar's AI investigations to investigate a real issue or question about your running app. Show what you learned and what you did with the findings.
4. Build something that makes conferences easier.

One real decision Radar helped you make is enough. More features don't score higher, and don't break things on purpose for the demo. Official wording: [hackathon page](https://www.wemakedevs.org/hackathons/cnh).

## What's on the cluster

Argo CD (Applications in your namespace, project `team-<team-name>`), Argo Rollouts, metrics-server, and a gateway that serves `https://<team-name>.cnh.radarhq.io` with TLS. Your namespace has a quota of 2 CPU and 4 GiB of requests and 4 CPU and 8 GiB of limits, and containers without their own requests and limits get small defaults.

## Bringing your own cluster instead

The same repo works on your own cluster (kind, k3d, minikube or a cloud cluster) with Argo CD installed, and Argo Rollouts if you use `examples/canary`:

1. Connect the cluster to your own free Radar Cloud organization: sign up at [app.radarhq.io](https://app.radarhq.io), click **Connect a cluster**, and run the Helm command it gives you.
2. Run `./scripts/setup.sh <team-name>`, then delete the `- httproute.yaml` line from `deploy/kustomization.yaml` (it points at the hackathon's gateway). Push.
3. Apply `argocd/application-byo.yaml` instead of `argocd/application.yaml`: it uses Argo CD's `default` project and creates the namespace.
4. Reach the app with Radar's port-forward, or `kubectl -n team-<team-name> port-forward svc/app 8080:80`.

## Help

Find Roy, Nadav or Arlen at the Radar table, or ask in the [Radar Discord](https://radarhq.io/community/chat).
