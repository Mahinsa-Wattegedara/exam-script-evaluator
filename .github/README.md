# Safety checks

`workflows/safety.yml` runs on pull requests, pushes to `Dev`, `main` and
`feature/**`, and manual dispatch. No application API keys, database passwords,
Gemini/OpenRouter credentials or production database access are needed.

| Check | Blocks |
| --- | --- |
| Repository safety | Tracked private environment/key files and feature PRs targeting main. |
| Secret scan | Detected secrets in the commits scanned by Gitleaks. |
| Backend tests | Dependency conflicts, Python syntax errors and failing unit/API tests. |
| Frontend checks | Dependency installation errors, failing persistence tests, type errors or failed builds. |
| Dependency audit | High/critical npm advisories and any known Python dependency vulnerabilities. |

Actions are pinned to full commit SHAs. The workflow uses read-only repository
permissions and disables persisted checkout credentials. PRs use `pull_request`,
not `pull_request_target`; application secrets are not passed into untrusted code.
Gitleaks PR comments and artifact uploads are disabled. Gitleaks scans commits,
not ignored local files; never stage a real `.env` file or credential.
`.gitleaksignore` records one reviewed historical template placeholder by its exact
commit/file/rule/line fingerprint. It does not exclude all example files or tests.

## Enable merge protection

After committing/pushing the workflow and its first successful run, open repository
**Settings → Rules → Rulesets** (or **Branches → Branch protection**) for `Dev` and
`main`. Require pull requests, at least one review, and these five status checks:

- Repository safety
- Secret scan
- Backend tests
- Frontend checks
- Dependency audit

Also block force pushes and branch deletion. Configure bypass permissions carefully.
The workflow itself reports failures; required checks are what prevent merging them.
Feature branches should merge into `Dev`, then `Dev` into `main`. Revert branches
are not blocked by the feature-to-main check.

## LangGraph dependency security fix

The initial audit found `PYSEC-2026-4240` in `langgraph-sdk==0.3.15`. Versions
below `0.4.4` are affected. The original `langgraph==1.2.0` required an SDK below
`0.4`, preventing a standalone SDK upgrade. Both backend dependency manifests now
pin the compatible pair `langgraph==1.2.24` and `langgraph-sdk==0.4.14`.
The dependency audit stays enabled; this advisory is not ignored and failures are
not configured to continue on error.

Dependabot opens weekly update PRs targeting `Dev` for npm, pip and Actions. Its
configuration must be present on the repository's default branch to activate.
This does not enable automatic merging or deployment.

The Gitleaks Action is free for personally owned repositories. If the repository is
moved to an organization, its action may require a `GITLEAKS_LICENSE` repository
secret; consult the upstream Gitleaks Action documentation.

## Test scope and local checks

Backend tests mock external AI and Supabase requests. They do not use a live database
or run migrations. The optional SQL integration test is not run in CI because
migration 002 is deliberately supplied separately and is not committed.

```powershell
python .github/scripts/check_repository_safety.py
Push-Location backend
.venv/Scripts/python.exe -m unittest discover -s tests -v
Pop-Location
# Run these from frontend:
npm ci
node --test tests/store-persistence.test.cjs
npm run typecheck
npm run build
npm audit --audit-level=high
```

For backend tests, run from `backend` or set `PYTHONPATH=backend` when invoking them
from the repository root. Security audit service outages fail the check rather than
silently treating unavailable results as clean. The checks cannot guarantee the
absence of every bug or secret.
