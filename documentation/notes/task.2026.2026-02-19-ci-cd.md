---
id: pgs8ia0qfi8m57n2genck35
title: 2026 02 19 CI CD
desc: ''
updated: 1771547051870
created: 1771546829350
---

## Goal

Set up reliable CI/CD for `stenobot` so we can:

- Validate every PR and `main` push.
- Publish to npm safely with reproducible provenance.
- Start with manual releases, then optionally move to tag-driven automation.

## Recommended Strategy

Use a phased rollout:

1. **CI first** (`ci.yml`): test/build on PR + `main`.
2. **Manual publish workflow** (`publish-manual.yml`): operator-triggered npm publish from GitHub Actions.
3. **Optional auto publish on tag** (`publish-on-tag.yml`): only after manual flow is stable.

Do **not** auto-publish on every merge to `main` because npm versions are immutable and merge frequency usually outpaces intentional versioning.

## Prerequisites

### GitHub

- Create `.github/workflows/`.
- Enable branch protection on `main` and require CI checks.

### npm

- Use npm Trusted Publishing (GitHub OIDC) for this repo/package.
- Prefer OIDC over long-lived `NPM_TOKEN`.
- Confirm package publish access and owner permissions.

### Package metadata

- Add `repository` in `package.json` (if missing) so npm provenance links cleanly back to source.
- Keep `prepublishOnly` build gate in place (`pnpm run build`).

## Phase 1: CI Workflow (`.github/workflows/ci.yml`)

### Triggers

- `pull_request`
- `push` to `main`

### Jobs

- `validate` on `ubuntu-latest`
- Node 20.10+ (aligned to `engines.node >=20.10`)
- Install with pnpm + lockfile enforcement

### Steps

1. Checkout.
2. Setup Node + pnpm cache.
3. `pnpm install --frozen-lockfile`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`
7. Optional: `pnpm pack --dry-run` (artifact sanity check)

### Exit criteria

- Required status check passes on all PRs.
- No direct merges without green CI.

## Coverage Quality (Not Vanity Coverage)

I do not want to optimize for raw total coverage percentage. I want PR-level confidence.

### Policy

- Generate coverage in CI (`vitest --coverage`).
- **Patch coverage** (new/changed lines in a PR) as the main gate.
- Overall coverage as a trend metric only (non-blocking initially).
- Require tests for bug fixes and high-risk paths (parsers, state transitions, command handlers), even when percentages look fine.

### Tooling options

1. **Codecov (recommended for badges + patch gates)**
2. **CodeRabbit (recommended for review feedback on missing/weak tests)**
3. **Mutation testing later (Stryker) if we want a stronger test-quality signal**

### Suggested rollout

1. Add coverage run to `ci.yml` and upload report artifacts.
2. Enable Codecov with a required patch threshold (example: 85%-90%).
3. Add README badge for patch/overall coverage trend.
4. Add CodeRabbit for PR review comments about missing edge-case tests.
5. Revisit thresholds after 2-3 weeks of real PR data.

## Phase 2: Manual Publish Workflow (`.github/workflows/publish-manual.yml`)

### Trigger

- `workflow_dispatch`

### Protections

- Use a GitHub Environment (for example `release`) with required reviewers.
- Restrict publish to `main` branch commits.

### Permissions

- `contents: read`
- `id-token: write` (for OIDC Trusted Publishing)

### Steps

1. Checkout selected ref (default `main`).
2. Setup Node + pnpm.
3. `pnpm install --frozen-lockfile`
4. `pnpm test`
5. `pnpm build`
6. Verify package version is not already published.
7. `npm publish --access public --provenance`

### Notes

- Manual trigger gives release control without local-machine publishing.
- If OIDC cannot be used yet, temporary fallback is `NPM_TOKEN` secret plus strict rotation.

## Phase 3: Optional Auto Publish on Tag (`.github/workflows/publish-on-tag.yml`)

Only enable after 2-4 successful manual releases.

### Trigger

- `push` tags matching `v*`

### Guardrails

- Ensure `tag == package.json version` (example: `v0.1.2` matches `0.1.2`).
- Fail if version already exists on npm.
- Same test/build/publish flow as manual workflow.

### Why tag-based instead of merge-based

- Release intent is explicit.
- Versioning is deterministic.
- Rollback and changelog generation are cleaner.

## Security and Supply Chain Controls

- Use OIDC Trusted Publishing + provenance attestation.
- Pin action versions to major or commit SHA where practical.
- Keep workflow permissions minimal.
- Keep dependency updates separate from publish changes.
- Treat scanner warnings like "URL strings" as review signals, not auto-blockers, unless behavior is suspicious.

### Dependabot: Security Updates Only

Enable **Dependabot security updates** in GitHub repo Settings → Code security → Dependabot security updates. Do **not** add a `dependabot.yml` with version updates — this keeps PRs scoped to real CVEs only, not routine version bumps.

- Security update PRs are triggered by GitHub Advisory Database entries, not new releases.
- Review and merge manually; do not auto-merge.
- Combine with `pnpm install --frozen-lockfile` in CI so the lockfile is the source of truth.
- Run `pnpm audit` locally or in CI on a schedule as a secondary signal.
- For suspicious packages (even without a CVE), use `npx socket-cli scan <package>` before merging.

## Release Runbook (Human Process)

1. Merge approved PRs to `main`.
2. Bump version (`npm version patch|minor|major`) in a dedicated PR.
3. After merge, run manual publish workflow.
4. Verify on npm (`npm view stenobot version`).
5. Create Git tag/release notes.
6. Once process is stable, switch to tag-triggered publish.

## Task Checklist

- [ ] Add `repository` metadata to `package.json`.
- [ ] Create `.github/workflows/ci.yml`.
- [ ] Create `.github/workflows/publish-manual.yml`.
- [ ] Add CI coverage collection and report upload.
- [ ] Configure patch-coverage quality gate (Codecov or equivalent).
- [ ] Add coverage badge to README (patch or project coverage).
- [ ] Add CodeRabbit PR review checks for test quality feedback.
- [ ] Configure npm Trusted Publishing for this repo.
- [ ] Configure GitHub Environment protection for release workflow.
- [ ] Add branch protection requiring CI on `main`.
- [ ] Enable Dependabot security updates in repo Settings (security-updates-only, no `dependabot.yml`).
- [ ] Perform first manual publish from Actions.
- [ ] Document release steps in `README.md` or `documentation/notes/dev.general-guidance.md`.
- [ ] Evaluate move to tag-driven auto publish after several successful releases.

## Done When

- CI runs on every PR and `main` push and is required for merge.
- PRs are gated on patch coverage quality (not just total project coverage).
- npm publish can be executed from GitHub Actions without local credentials.
- Published artifacts include provenance.
- Team has a documented, repeatable release path.
