---
title: Deployment scope and evidence
type: check
when: PR changes Dockerfile, deploy, argocd, .github/workflows or deployment claims
actions: Report unresolved deployment risk and apply deploy-risk until corrected
---

Before integration, inspect the intended owned destination, build/rollout configuration, resource budget, non-root execution and optional credentials. Never approve a guessed team or a push to the public starter. Pre-deployment PRs may accurately say awaiting deployment; do not demand an impossible future rollout before merge. A claim that deployment succeeded must link matching Argo revision, healthy workload image and served version. Do not alter pre-installed components or use another team's cluster.
