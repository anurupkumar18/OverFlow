# Autoscaling with an HPA

1. Copy `hpa.yaml` into `deploy/` and add it to `resources:` in `deploy/kustomization.yaml`.
2. Delete the `replicas:` line from `deploy/deployment.yaml`. Otherwise Argo CD puts the replica count back on every sync and fights the autoscaler.
3. Push. Argo CD applies it.
4. Send real load at your URL (an event-day rush, a load test, everyone in the room opening it) and watch the HPA scale out in Radar: the HPA's page, and the scale-up on the timeline.

The HPA scales on CPU against your container's `requests.cpu`, so keep a CPU request in the Deployment. Your namespace's quota caps how far it can scale: at 100m per pod, the quota's 2 CPU of requests fits about 20 pods.
