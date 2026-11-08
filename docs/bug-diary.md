# Observed implementation findings

These are local agent/reviewer findings, not Agent0 or Radar investigations.

| Observation | Decision/fix | Evidence |
|---|---|---|
| Actual browser/server collector contained a synthetic private page query in stable OTel `url.query` | Scrub stable and legacy URL attributes, normalize routes, redact unknown paths and test combined exports | `scripts/browser-otlp-smoke.cjs`, telemetry unit tests |
| All Plan B ranking modes failed after a successful crowd read; snapshot could recommend a verified full room | Carry only validated observations into local fallback and preserve explicit full exclusions | `app/tests/planb-http.test.js` |
| Fresh CI could test an old remote corpus after the proposed local catalog changed | Require actual indexed corpus identity to match the checked-out catalog before collecting ranking evidence | `scripts/tests/test_ci_evaluation.py` |
| A server trickled response-header bytes beyond the operator request deadline | Own a subprocess per request, enforce the whole-request deadline, kill/reap on timeout | Actual slow-header regression;0.163 seconds at a0.15-second deadline |
| Room alerts vanished with a toast, stale counts persisted, and a pending subscription could be lost when pausing | Retain named actions inside/outside dialogs, validate fresh observations and preserve every acknowledged watch while respecting pause | Controller and actual-browser regression scenarios |

Earlier findings and corrections are in `review-summary.md`. No hosted finding/decision/commit entry has been substituted with these local observations.
