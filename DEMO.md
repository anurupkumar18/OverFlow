# Overflow demo

## 90 seconds

1. “Overflow helps attendees keep a useful plan when a conference room fills. This local build uses 470 real public schedule entries.”
2. Search for a topic and choose a day. Open a real session and show its official source.
3. Save it. Show the personal itinerary and explain that this save is on this device.
4. Open Plan B. Explain the time-window, different-room and venue-aware same-floor checks. Show the reason text.
5. Point out the visible snapshot state and unknown room signals. “Capacity is an estimate; we do not pretend to know live attendance.”
6. Show `docs/qa.md` and the local collector proof, while clearly saying remote cloud integration and relevance evaluation are still unverified.

## Four minutes

Add the one-service architecture, actual data provenance, one boundary test (same floor in different buildings), and the graceful fallback test. Demonstrate an empty query result and recovery by clearing filters. Show a saved plan after reload and calendar export if verified in QA.

## Questions and truthful answers

- **Is 200 the actual room capacity?** No. It is a uniform planning estimate, shown as such everywhere.
- **Are these talks real?** Yes, normalized from the official LF-linked public schedule. See SOURCE.md for exact scope and retrieval timestamp.
- **Does “unknown” mean space is available?** No. It means live crowd observations are unavailable.
- **Which ranking mode wins?** Not measured yet. We need human labels and real queries against the configured Elastic deployment.
- **Is this deployed?** Not at this local-build checkpoint. A live claim needs the actual revision, healthy workload, and URL serving that version.
- **Was it built during the hackathon?** Development began November 8 by explicit user instruction; official build window begins November 9. Eligibility is not asserted.
- **Who did what?** See docs/human-log.md. Codex built and tested; no provider-agent findings or human labels were invented.

The owner still needs to record and submit any competition video. This script is not proof a video exists.
