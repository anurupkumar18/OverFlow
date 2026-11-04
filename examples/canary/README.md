# Canary releases with Argo Rollouts

Argo Rollouts is installed on the hackathon cluster. To ship every change as a canary:

1. Copy `rollout.yaml` into `deploy/`. In `deploy/kustomization.yaml`, replace `deployment.yaml` with `rollout.yaml` under `resources:`.
2. If you use the HPA, change its `scaleTargetRef` to `apiVersion: argoproj.io/v1alpha1` and `kind: Rollout`, and delete `replicas:` from the Rollout.
3. Push. Argo CD swaps the Deployment for the Rollout.
4. Push a visible change (a new heading, a new API field). The new version gets 25% of the pods and pauses.
5. Check it, then promote it through Radar: ask your agent to promote the rollout (Radar's MCP tool `manage_rollout`), or use the Rollout's page in Radar Cloud. If it's bad, abort it and the old version takes all the traffic back.

The split is by pod count (one in four pods runs the new version), because the cluster's gateway isn't wired as a traffic router for Argo Rollouts. Blue-green works too: swap the `canary:` block for `blueGreen:` (see the [Argo Rollouts docs](https://argo-rollouts.readthedocs.io/en/stable/features/bluegreen/)), with a second Service for the preview.
