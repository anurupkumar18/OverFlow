# What the AI SRE track judges look for

The official wording is on the [hackathon page](https://www.wemakedevs.org/hackathons/cnh); this is our summary. It isn't a checklist: build your project the way that suits it, and show the judges what Radar did for it.

1. **Your app runs on Kubernetes with Radar connected**, in the namespace we give your team or on your own cluster.
2. **Show what Radar did for your project.** Some examples, pick what fits your story:
   - your agent shipping a GitOps or canary release through Radar's MCP (`examples/canary`, then `manage_rollout` to promote or abort);
   - autoscaling under real load (`examples/hpa`, then the scale-out on Radar's timeline);
   - fixing what Radar's Checks flagged (open Checks for your namespace, or ask your agent to call `get_cluster_audit`);
   - Radar's AI SRE finding the cause of something that really broke (Investigate on the failing resource in Radar Cloud), and the fix that followed.
3. **Radar is part of how you built and ran it**, not one call at the end. A stretch of your agent's session working through Radar's MCP shows this well.
4. **How well your project makes conferences easier.**

Show one meaningful decision Radar helped your team make: a verified healthy release, a Check you fixed, a rollout you promoted or aborted, or the cause of a real problem. Explain the evidence and what you did. More features or tool calls don't score higher.

Don't break things on purpose for the demo.
