# Overflow's engineering story

The problem is a physical one: an attendee needs a useful alternative before crossing the venue. The system keeps schedule time, room, building and floor as explicit facts. A matching floor number in a different building is not treated as nearby.

The first meaningful integration finding was local: current OpenTelemetry SDKs exported traces and metrics while a legacy logs API silently failed to register against the current provider. A bounded local collector test exposed the missing log signal. Switching to the stable logs API made the same test receive traces, logs and metrics. This is a Codex/local finding, not an Agent0 or Radar finding.

The strongest product constraint is honesty. A schedule source is not a live attendance sensor. Unknown crowd counts remain unknown, capacity estimates stay labeled, and snapshot search stays visibly degraded. A personal bookmark is useful even when shared crowd writes are unavailable, but it must not be represented as a shared signal.

There is no real Radar investigation, deployed revision, or infrastructure rightsizing recommendation yet. The deployment story remains pending verified access and evidence.
