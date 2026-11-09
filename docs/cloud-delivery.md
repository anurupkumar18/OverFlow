# Cloud delivery evidence

The user authorized public repository `anurupkumar18/OverFlow` and team name `OverFlow` on November 8,2026. The deployment slug is `overflow`, consistent with the registration form's lowercase constraint. The actual team cluster has not yet been registered or verified.

## Repository and image

The complete reviewed source was published to [the owned repository](https://github.com/anurupkumar18/OverFlow). First application commit: `b056fcf2810b9b73706528f5d9d42c5b251a2a83`.

[Build42558634422](https://github.com/anurupkumar18/OverFlow/actions/runs/42558634422) completed successfully and published `ghcr.io/anurupkumar18/overflow:b056fcf`. Its bot commit `5bc46367ed32082bd06ab179cb023b0d8f04fa44` updated the image in the deployment manifest and was pulled locally. A credential-free registry token/manifest request returned HTTP200 for this tag, verifying public pull access. Observed digest: `sha256:dc09ff6f18cbf6da5dc83a8238ecf0146f58c99f6db36bfc6d8c5073db977497`.

This is actual container build/publication evidence. It does not prove a Kubernetes rollout or public app deployment.

## Remote checks

[CI42558740934](https://github.com/anurupkumar18/OverFlow/actions/runs/42558740934) ran on `5bc46367ed32082bd06ab179cb023b0d8f04fa44`:

- Passed: change detection, container build, Python/data checks and app checks in UTC, America/Denver and Asia/Tokyo.
- Failed: browser telemetry smoke did not observe its sanitized error at the collector. This was a real CI failure. [PR1](https://github.com/anurupkumar18/OverFlow/pull/1) fixes a reproduced harness teardown race: wait for collector delivery before ending the document, then navigate to flush Web Vitals. Assertions/timeouts remain intact; local Chromium headless shell and Chrome both pass. The PR's Linux CI result must be checked separately.
- Unsatisfied: fresh ranking evidence reports `not_evaluated`, n=0, because approved human evidence and provider configuration are absent. The gate remains enabled.

The required review labels (`needs-eval`, `api-contract-drift`, `deploy-risk`, `gitar-managed`) were created. Gitar/Dash0 GitHub App authorization and real reviews remain unverified.

## Accounts and deployment

Radar's OAuth connection was registered and login completed. Radar tools have not appeared in this current chat, and organization membership, team cluster access and deployment are still unverified. The user reports that the team has not been created. Registration requires the organizer's join code and a participant email; the registration form was opened with team `overflow` for the user to complete.

Elastic/Dash0 projects, scoped keys, inference endpoints and dataset connections remain pending. No provider secret or cluster resource has been created. The intended `https://overflow.cnh.radarhq.io` URL is configuration only; do not describe it as live until revision, workload image/health and served version agree.
