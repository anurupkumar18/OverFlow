# Gitar integration preparation

The repository contains review guidance, five check rules, CI instructions and apply/approve/merge/risk criteria. These are prepared configuration, not evidence that Gitar has reviewed this code. No repository App installation, labels, toggles, comments or PRs were changed by this local build.

In the actual owned repository, install/authorize Gitar, create the `needs-eval`, `api-contract-drift`, `deploy-risk` and optional `gitar-managed` labels, and verify that a real PR loads these files. Keep auto-merge off. Resolve each real finding and record its PR URL, head revision, verdict and response in `docs/gitar-log.md`. Do not create artificial findings to inflate that log.

The configuration uses the documented [repository layout](https://docs.gitar.ai/configuration/repository-config) and [Markdown rule format](https://docs.gitar.ai/features/rules). Approval/apply/merge criteria take effect from the default branch, so a file on this unpushed local branch is not an account setting. Actual review and rule execution remain unverified.
