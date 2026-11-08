# Automatic fix criteria

Only apply a review fix when the PR explicitly opts into Gitar-managed fixes and the change is narrow, independently testable and within that PR's scope. Do not silently alter deployment destinations, secrets, evaluation labels/baselines, public API compatibility, ranking policy or user data. Report the required decision instead. Do not manufacture staged defects or hide an unavailable dependency.
