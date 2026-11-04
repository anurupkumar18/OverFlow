# AI SRE track: the judging points, and where each one shows

The judging criteria are on the [hackathon page](https://www.wemakedevs.org/hackathons/cnh). This is a checklist for your demo: for each point, what to do and where the judges will see it in Radar Cloud.

- [ ] **Your app runs on Kubernetes with Radar connected, and you and your agent operate it through Radar's MCP server and UI.**
  Your app is live at your URL and your team's namespace is healthy in Radar Cloud.
- [ ] **GitOps deploys.**
  Every change ships as a push to `main`, and Argo CD syncs it. Show the Application in Radar's GitOps view and its sync history.
- [ ] **Autoscaling.**
  Turn on `examples/hpa` and make it scale under real load. Show the HPA and the scale-out on Radar's timeline.
- [ ] **A canary or blue-green rollout.**
  Turn on `examples/canary`, ship a change, and promote it (or abort a bad one) through Radar's MCP. Show the Rollout's steps and the promote on the timeline.
- [ ] **Fixing what Radar's Checks flag.**
  Open Checks for your namespace (or have your agent call `get_cluster_audit`), fix the findings in git, and show the before and after.
- [ ] **Radar is part of how you ship, not one call at the end.**
  Your agent deploys, debugs, triggers rollouts and checks the audit through Radar's MCP. Show a stretch of the agent's session.
- [ ] **Radar's AI SRE finds and fixes something real during the day.**
  When something actually breaks (it will), start an AI investigation in Radar Cloud, follow the evidence to the cause, fix it, and show the investigation and the fix on the timeline. Don't break things on purpose; the judges are looking for a real failure.
- [ ] **Your project makes conferences easier.**
