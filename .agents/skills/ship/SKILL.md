---
name: ship
description: Deploy a change to this team's cluster at the hackathon and confirm it is live. Use after editing app/ or deploy/, when asked to ship, deploy, release or push a change, or to check that the latest commit is running. Covers first-time GitOps setup too.
---

# Ship a change and prove it's live

Deploys are GitOps: you push to `main`, the GitHub Action builds the image and commits the new tag, and Argo CD (inside the team's cluster) syncs the namespace. A push is not a deploy. You're done only when the new version answers at the team URL.

The team name is in `deploy/kustomization.yaml` (`namespace: team-<team>`). Radar Cloud lists the team's cluster as `<team>`. The namespace is `team-<team>`, the Argo CD Application is `app` in that namespace, and the URL is `https://<team>.cnh.radarhq.io`.

**Every Radar MCP call below takes `cluster` and `namespace: team-<team>`.** Call `list_clusters` once, take the `id` of the entry whose `name` is exactly `<team>`, and pass it as `cluster`. The organization has about 40 team clusters plus `cnh`, so the tools can't pick a default, and the person only has access to this team's cluster.

## 0. First time only

Skip this if `get_resource` (kind `Application`, group `argoproj.io`, name `app`) finds the Application.

1. If `deploy/kustomization.yaml` still says `team-__TEAM__`, run `./scripts/setup.sh <team>` first. Ask for the team name if you don't know it.
2. Push (step 1 below) and wait for the first build (step 2).
3. The person must make the GHCR image public once: repo page > Packages > Package settings > Change visibility > Public. You can't do this for them. Ask, and wait until they confirm.
4. Apply `argocd/application.yaml` with `apply_resource` (with `cluster`). This is the only app manifest you apply straight to the cluster. The starter app is already running; Argo CD takes it over.

## 1. Push

Commit and push to `main`. Note the short SHA: `git rev-parse --short=7 HEAD`.

The Action skips commits that only touch `*.md` or `deploy/kustomization.yaml`. Changes only under `deploy/` (other than the image) need no build, so go straight to step 3.

## 2. Wait for the build

With the GitHub CLI: `gh run list --branch main --limit 1`, then `gh run watch <id> --exit-status`. Without it: `git fetch origin` until `origin/main` has a commit `deploy: <sha> [skip ci]`.

If the run failed, read `gh run view <id> --log-failed`, fix it, and push again. Then `git pull --rebase` so your copy has the bot's deploy commit before you push again.

## 3. Sync

Argo CD polls git every few minutes. Don't wait for it: call `manage_gitops` with `cluster`, `tool: argocd`, `action: sync`, `namespace: team-<team>`, `name: app`.

Radar's sync ignores the Application's own `syncOptions`. The starter's Application has none and needs none. If you added `syncOptions` to an Application (say `ServerSideApply=true` for large CRDs, or `CreateNamespace=true` for a new namespace), pass the same list as `sync_options` on every sync of it.

Then `get_resource` on the Application and check both of these:
- `status.sync.revision` equals `git rev-parse origin/main` (after `git fetch`);
- `status.sync.status` is `Synced` and `status.health.status` is `Healthy`, or `Progressing` while pods start.

## 4. Wait for the rollout

Call `wait_for` with `kind: deployment` (or `rollout` if `deploy/` uses `rollout.yaml`) and `name: app`. Each call waits at most 45 seconds, so repeat it until it reports done, for up to about 5 minutes.

A Rollout pauses at 25% on purpose. For that flow, use the `canary-release` skill.

## 5. Verify from outside

`curl -s https://<team>.cnh.radarhq.io/`. The starter app prints `version <sha>`, and it must match the SHA from step 1. If you replaced the app, request something your change made visible.

If anything here is red (a failed sync, pods not ready, the old version still serving, a 404 or 503 from the URL), switch to the `debug-failure` skill. Don't push guesses.

## Don't

- Don't call a Radar tool without `cluster`.
- Don't apply app manifests with `apply_resource` or `patch_resource`. Argo CD's self-heal reverts them within seconds.
- Don't edit `newName` or `newTag` in `deploy/kustomization.yaml`; the Action owns them.
- Don't report "deployed" after the push. Report what step 5 showed.
