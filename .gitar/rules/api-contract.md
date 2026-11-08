---
title: API contract coverage
type: check
when: PR changes app/src/app.js, app/src/routes.js, app/public/js/api.js or contract/api.json
actions: Report contract drift and apply api-contract-drift until corrected
---

Compare routable methods/paths and caller roles with OpenAPI. Every browser operation must have a real wrapper in api.js and an exercised response. Internal routes stay authenticated and out of browser callers. Require the contract test to pass on the PR head, and inspect response-shape changes beyond its route coverage.
