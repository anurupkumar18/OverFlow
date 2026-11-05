# Notes for your coding agent

This repo deploys to one namespace, `team-__TEAM__`, on the Cloud Native Hackathon's shared Kubernetes cluster. Use Radar Cloud's MCP server (`radar-cloud`) for everything you observe or change on the cluster. There is no kubeconfig. Radar acts as the signed-in person, so it sees and changes only this namespace. Pass `namespace: team-__TEAM__` wherever a tool takes it. Read each tool's schema; don't invent parameters.

Deploys are GitOps: change the repo, push to `main`, and Argo CD syncs the namespace. Don't apply or patch app manifests on the cluster. Argo CD's self-heal puts the repo's version back. The one exception is `argocd/application.yaml`, applied once to start the sync.

## When to do what

- **First cluster access in a session.** List the clusters and read this namespace's workloads. If the hackathon cluster isn't there, the person hasn't accepted the Radar Cloud invite, or picked a different organization when connecting. Ask them to pick **Cloud Native Hackathon** under "Organization access" (reconnect the MCP server). If the cluster is there but `team-__TEAM__` isn't among its namespaces, this account isn't on the team: it must use an email the team listed when it joined, and access turns on about a minute after accepting the invite. Otherwise, ask an organizer at the Radar table. Don't go on until you can read the namespace.
- **After every push.** Wait for the GitHub Action and its `deploy: <sha> [skip ci]` commit. Sync or inspect the Argo CD Application through Radar, wait for the rollout, then check three things before saying it's deployed: the synced revision, workload health, and the URL showing the new version. Procedure: the `ship` skill.
- **A deploy or the app fails.** Read the evidence first: `issues`, `get_changes`, events, logs (`diagnose` bundles them). Name the cause, then fix it in git. Procedure: the `debug-failure` skill.
- **A canary is paused.** That's a release decision, not a stuck wait. Stop waiting at the pause, check the canary pods and the URL, show the person what you saw, and promote or abort only when they say so, unless they already told you to. Procedure: the `canary-release` skill.
- **Once, before the demo.** Review Radar's Checks for this namespace (`get_cluster_audit`). Fix a finding that applies to this team's workloads, or say why it doesn't apply. Don't try to fix cluster-wide findings.
- **A real symptom you can't explain.** Suggest the person start an AI investigation in Radar Cloud: Investigate on the failing resource. It traces the failure to a cause with evidence and changes nothing. That's a separate hosted run; `diagnose` doesn't start it.

## Never

- Break things on purpose, or generate load you can't bound.
- Touch other teams' namespaces, or try to change quota, RBAC or cluster settings.
- Poll forever. Each wait has a limit (`wait_for` waits up to 45 seconds per call). After about 5 minutes, report what's blocking instead of retrying.

## Skills

`.agents/skills/` has the three procedures named above: `ship`, `debug-failure` and `canary-release`. Claude Code and Codex load them as skills. If your agent doesn't, read the matching `SKILL.md` before that task.

## Limits

- Quota for the namespace: 2 CPU and 4 GiB of requests, 4 CPU and 8 GiB of limits. The starter pod's 500m CPU limit means 8 pods at most. Containers without their own requests and limits get small defaults.
- Your public URL is `https://__TEAM__.cnh.radarhq.io`. The HTTPRoute can only claim that hostname.
- Images come from GHCR and must be public.
