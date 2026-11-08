# CI evidence

Run the checks relevant to changed behavior and inspect their result. Do not rewrite assertions merely to silence a failure. Keep test fixtures separate from measured evaluation or provider evidence.

`npm ci --prefix app` and `npm run build:browser --prefix app` prepare the app. `npm --prefix app test` includes API contract coverage. The Python suite is `python3 -m unittest discover -s scripts/tests -v`. Ranking changes require the fresh-provider CI job; the informational saved-results report is not a substitute.

No command may print credentials or read a user's private file for review. A missing cloud connection or human baseline must stay explicit. Never change required checks to accept absent evidence. Do not push to the upstream template or alter unrelated teams' infrastructure.
