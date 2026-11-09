# Remaining account setup

Repository: [anurupkumar18/OverFlow](https://github.com/anurupkumar18/OverFlow). It is created and published. The first image is built and publicly pullable; GitHub authentication and package visibility need no further user action.

## Radar

The `radar-cloud` MCP entry is configured at `https://api.radarhq.io/mcp`, enabled, and OAuth login succeeded. Tools are not yet exposed in this chat, so access cannot be inferred from login alone.

Use [hackathon registration](https://join.cnh.radarhq.io/) with team slug `overflow`, the participant email(s), and the organizer-issued join code. The code is provided at kickoff/Radar table. Complete the terms step personally and accept the organization invitation. Select **Cloud Native Hackathon** during organization access. Do not share the join code in chat. The team must be observed with the intended membership before any cluster mutation. [Organizer resources](https://www.wemakedevs.org/hackathons/cnh/resources).

## Elastic

Create/sign in at [Elastic Cloud](https://cloud.elastic.co/registration) and choose the intended project using your hackathon entitlement or budget. Share the Elasticsearch endpoint, not a key. The agent can then discover compatible inference endpoints and prepare the exact key privileges and indexing plan before applying it.

Runtime `ES_API_KEY` needs read access to `talks` and appropriate document operations on `interactions`, `talk_alerts` and `overflow_settings`; a read-only runtime key cannot support interest, watches and settings. Separate `ES_ADMIN_KEY` and `ES_READ_KEY` serve ingestion/evaluation. Provision keys privately after the scope is prepared; do not paste them in chat. [Endpoint/key guide](https://www.elastic.co/docs/solutions/search/set-up/api-key-and-endpoints).

## Dash0

Create/sign in at [Dash0](https://www.dash0.com/sign-up?utm_source=wemakedevs), select the intended organization/region, and use an `overflow` dataset. Share the region, dataset name and displayed API/OTLP/MCP endpoint URLs. The API, telemetry-ingestion and MCP URLs are different.

Use separate dataset-restricted ingestion and reading tokens. Browser telemetry, if enabled, needs its own ingestion-only token because it is publicly observable. Keep server credentials private. The agent will configure exports, verify traces/logs/metrics and browser correlation, and apply the dashboard with the required authorized access. [Getting started](https://www.dash0.com/docs/dash0/get-started), [token permissions](https://www.dash0.com/docs/dash0/miscellaneous/glossary/auth-tokens).

## Review apps and human evaluation

Sign up through [Gitar](https://app.gitar.ai/sign-up), then initiate GitHub App installation from its onboarding/dashboard for this repository. Keep auto-merge off. No Gitar runtime API key is needed. Authorize the Dash0 GitHub App when following its account onboarding. The agent handles labels, PRs and finding resolution; real App authorization/reviews must still be observed. [Gitar installation](https://docs.gitar.ai/connecting-code/github).

All 20 suggestions were approved unchanged on November 9, 2026 and are active in `eval/queries.json`. After real provider runs create a blinded result pool, judge results 0/1/2 yourself and review the measured baseline. No labels are requested before that pool exists. The agent handles metrics, CI and subsequent QA. Recording, human acceptance and submission remain actual user actions.
