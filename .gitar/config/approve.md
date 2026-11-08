# Approval criteria

Withhold approval while the PR has `needs-eval`, `api-contract-drift` or `deploy-risk`. Require resolved Important/Critical findings and passing applicable checks on the current head. A ranking PR needs fresh, comparable, human-judged evidence; n=0 or not_evaluated cannot satisfy that criterion. Do not mistake local SDK/fixture evidence for remote provider verification.
