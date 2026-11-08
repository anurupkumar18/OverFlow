# Decisions

| Decision | Why | Rejected alternative |
|---|---|---|
| Build began Nov 8, 2026 | Explicit current user instruction | Waiting until Nov 9 11:00; no eligibility claim |
| Use 470 real public schedule entries | Official LF-linked Sessionize API; validated intervals | Inventing a synthetic conference |
| Uniform capacity 200, clearly estimated | Official schedule has no capacities | Pretending room capacities are verified |
| Null crowd counts without ES | Missing observations are unknown | Showing zeros or fabricated pressure |
| Local device saves in snapshot mode | Usable personal planning without server writes | Implying saves feed shared popularity |
| One Node service, plain browser modules | Small explainable architecture and accessible native dialogs | Framework complexity without user benefit |
| Same-floor means same venue and floor | Schedule spans Salt Palace and Hyatt | Equating Level 2 across buildings |
| Stable OTel logs API | Real local collector caught a legacy logs API/SDK mismatch | Claiming config alone proves logging |
| Keep infrastructure template unprovisioned | No verified target repo, Radar cluster or cloud credentials | Deploying to guessed ownership/account |
| User chose earth tones + one accent | Direct palette response during build | Keeping an inferred blue surface palette |

All implementation decisions except the explicit start-now and palette instructions are agent choices, not attributed to the user.

## Plan B coverage in the real local index

Elasticsearch 9.5.6 returned no strict MLT result for 11 of 12 sampled real sessions, despite time/room-eligible candidates. Preserve strict nonempty results. Only after a complete empty response, retry a broader 10% lexical threshold within the existing stage deadline and all safety filters. Disclose broader-topic matches and degraded status when that retry supplies results. A failed or empty broader attempt preserves the valid strict empty result. This is a candidate-coverage policy; relevance quality remains unmeasured without human labels.
