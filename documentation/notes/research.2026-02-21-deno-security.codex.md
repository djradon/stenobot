---
id: nkjiog6j9ldbofl6kqbfsgd
title: 2026 02 21 Deno Security (Codex Rewrite)
desc: ''
updated: 1771712396647
created: 1771712396647
---
# Kato Deno Security Plan (Codebase-Grounded Rewrite)

## Executive Summary

A ground-up rewrite to Deno is reasonable, but only if the rewrite is treated as a **security architecture project**, not a runtime swap.

Based on the current Stenobot proof-of-concept, the biggest security and corporate-readiness gaps are:

- Unbounded file write destinations from in-chat commands (`src/core/monitor.ts`).
- Ambiguous command triggering from natural-language parsing (`src/core/detector.ts`).
- Single trust domain for discovery, parsing, command handling, and export (`src/core/monitor.ts`, `src/providers/*`).
- Plaintext sensitive artifacts with default file permissions (`src/config.ts`, `src/core/state.ts`, `src/utils/logger.ts`).
- Limited auditable security controls (no explicit permission policy artifact, no path-policy regression suite).

The POC does contain strong foundations worth carrying forward: provider abstraction, offset-based incremental parsing, lock-file daemon lifecycle, atomic state persistence, and high parser test coverage.

Recommendation: proceed with the Deno rewrite as Kato, with a strict v1 security scope and explicit policy/testing gates.

## What To Preserve From Stenobot

These are strong implementation decisions that should be ported rather than reinvented:

1. Provider abstraction and registry-based enablement (`src/providers/base.ts`, `src/providers/registry.ts`).
2. Byte-offset incremental parsing for large append-only session files (`src/core/monitor.ts`, `src/providers/*/parser.ts`).
3. Immediate user-message emission in Codex parsing to preserve command timing (`src/providers/codex/parser.ts`).
4. Atomic state writes via temp file + rename (`src/core/state.ts`).
5. Daemon single-instance lock semantics (`src/cli/commands/start.impl.ts`).
6. Fixture-driven parser tests covering multiple provider formats (`tests/codex-parser.test.ts`, `tests/parser.test.ts`).

## Security Gaps In The POC (And Kato Requirements)

### 1. Output path control is too permissive

Current behavior:
- In-chat `::record` / `::capture` / `::export` can resolve to arbitrary absolute paths.
- Relative paths can traverse outside intended project boundaries.
- Path normalization does not enforce an allowlist root.

Code surface:
- `src/core/monitor.ts` (`resolveOutputPath`).

Kato requirement:
- Enforce a mandatory write allowlist root (default `~/.kato/exports`).
- Require explicit opt-in policy for writes outside that root.
- Resolve realpath and reject symlink escapes.

### 2. Command detection is intentionally loose

Current behavior:
- Commands can be detected when embedded in prose.
- Parser attempts to infer path-like tokens from natural language.

Code surface:
- `src/core/detector.ts`.

Kato requirement:
- Default to strict command grammar (line-start command, explicit args).
- Keep compatibility mode as optional and off by default in corporate profile.
- Add a confirmation/approval layer for first write target per session.

### 3. Single process trust boundary is too broad

Current behavior:
- One process handles watching, parsing, command interpretation, and writing.
- If any parser or dependency is compromised, blast radius spans all capabilities.

Code surface:
- `src/core/monitor.ts`, `src/providers/*`, `src/core/exporter.ts`.

Kato requirement:
- Split duties with least-privilege workers (read-only parser workers, write-limited export worker).
- Keep orchestrator minimal and policy-driven.

### 4. Sensitive data handling is minimal

Current behavior:
- Config/state/log/export files are created without strict mode controls.
- Conversation content and metadata are plaintext by default.

Code surface:
- `src/config.ts`, `src/core/state.ts`, `src/utils/logger.ts`, `src/core/exporter.ts`.

Kato requirement:
- Enforce file mode policy (user-only access where supported).
- Minimize log content by default (no message content unless explicitly enabled).
- Support retention/cleanup policy as first-class config.

### 5. Parser trust assumptions are high

Current behavior:
- Session files are treated as trusted append-only logs.
- Invalid/corrupt JSONL lines are mostly skipped silently.

Code surface:
- `src/providers/claude-code/parser.ts`, `src/providers/codex/parser.ts`.

Kato requirement:
- Add parser anomaly counters and security telemetry (invalid line rate, malformed tool payloads, unexpected schema spikes).
- Add parser hardening tests for hostile/poisoned logs.

### 6. Auditability is not sufficient for enterprise security review

Current behavior:
- Functional logs exist, but no dedicated permission decision log or policy decision trace.

Kato requirement:
- Emit structured security audit events (command detected, path approved/denied, policy version, permission profile used).
- Keep a separate audit stream from operational debug logs.

## Kato Security Objectives (Corporate Profile)

1. Least privilege by default for read/write/net/run/env/ffi/sys.
2. Deterministic, testable filesystem boundaries.
3. Explicit policy artifacts that are reviewable and versioned.
4. Tamper-evident operational and security logs.
5. Safe failure behavior (deny > fallback).
6. Cross-platform baseline controls (Linux/macOS/Windows).

## Proposed Deno Architecture

### Core model

- `kato` orchestrator process:
  - Loads policy.
  - Schedules discovery/parse/export jobs.
  - Never writes outside approved roots.
- Provider parser workers (Deno Workers):
  - Read-only access to session files and provider config.
  - No network, no subprocess, no env.
- Destination-scoped writer workers:
  - Spawn a new writer worker for each active `::record` / `::capture` destination.
  - Grant write permission only to that single destination file (plus any minimal temp path needed for atomic append strategy).
  - On destination change, terminate old writer worker and create a new one with the new file-scoped permission.
  - Keep provider-session read permissions out of writer workers.
- State/audit store:
  - Centralized under `~/.kato/`.

### Filesystem layout

Recommended baseline:

- `~/.kato/config/policy.yaml`
- `~/.kato/state/state.json`
- `~/.kato/exports/...`
- `~/.kato/logs/kato.log`
- `~/.kato/logs/security-audit.jsonl`

### Path policy

Enforce in one policy engine module used by CLI and daemon paths:

1. Canonicalize via `realpath` before allow/deny decision.
2. Reject path traversal and symlink escapes.
3. Reject ambiguous Windows forms (`\\?\`, UNC) unless explicitly allowed.
4. Keep provider session roots read-only.
5. Keep export roots write-only where practical.

### Command policy

Corporate default mode:

- Only parse commands that are standalone at line start.
- No natural-language token inference.
- Optional `--compat-commands` for legacy behavior, off by default.
- Optional “first-write destination approval” prompt in interactive mode.

## Deno Permission Profiles

Use separate permission profiles for each command/mode.

### Daemon profile

- Allow read: configured provider session roots + `~/.kato/config` + `~/.kato/state`.
- Allow write: `~/.kato/state`, `~/.kato/logs`, `~/.kato/exports`.
- Deny net/run/env/ffi/sys by default.

### One-shot export profile

- Allow read: target session file path + policy/config.
- Allow write: explicit output path only.
- Deny net/run/env/ffi/sys.

### Destination-scoped writer worker profile

- Allow read: none (input arrives over worker messages).
- Allow write: one destination file path (or destination directory if append implementation requires temp file/rename).
- Deny net/run/env/ffi/sys.
- Lifecycle: one worker per active destination; rotate worker on destination change.

### CI/security profile

- `--no-prompt`
- frozen lockfile and cached-only/offline dependency mode.
- permission-audit capture enabled for regression checks.

## Migration Roadmap

### Phase 0: Security design freeze (1 week)

Deliverables:
- Threat model.
- Data classification.
- Path policy spec.
- Command policy spec.
- Permission matrix.

Exit criteria:
- Security policy docs reviewed and accepted before coding.

### Phase 1: Parser and provider parity (1-2 weeks)

Deliverables:
- Deno provider interface and registry parity with Stenobot.
- Claude + Codex parsers with existing fixture parity.
- Offset resume behavior preserved.

Exit criteria:
- All parser fixtures pass with golden output comparison.

### Phase 2: Boundary enforcement (1-2 weeks)

Deliverables:
- Central path policy module.
- Strict command parser default.
- Audit log stream for allow/deny decisions.

Exit criteria:
- Path traversal and symlink escape tests pass.
- No writes outside allowlist in integration tests.

### Phase 3: Daemon and lifecycle hardening (1 week)

Deliverables:
- Single-instance lock + stale lock recovery.
- Crash-safe state persistence.
- Structured operational logs.

Exit criteria:
- Restart/stop/start race tests pass.

### Phase 4: Packaging and supply chain controls (1 week)

Deliverables:
- Reproducible build instructions.
- Signed release artifacts.
- CI gates: lint/test/security regression/permission audit.

Exit criteria:
- Release process repeatable from CI only.

### Phase 5: Corporate profile completion (1 week)

Deliverables:
- Security baseline preset enabled by default.
- Retention/redaction defaults.
- Admin-facing security configuration docs.

Exit criteria:
- Internal security review can map controls directly to policy/test artifacts.

## Required Security Test Suite For Kato

1. Path traversal tests (`../`, mixed separators, absolute path overrides).
2. Symlink race tests (swap target after validation).
3. Command confusion tests (commands embedded in prose should not execute in strict mode).
4. Parser poisoning tests (malformed JSONL, oversized lines, repeated schema anomalies).
5. Permission boundary tests (worker attempts forbidden read/write/net/run/env).
6. Restart/race tests (double start, stale lock, abrupt kill).
7. Audit completeness tests (every allow/deny decision logged with policy version).

## Decision: Should We Rewrite In Deno?

Yes, with constraints.

The rewrite makes sense because Kato can use Deno permissions and worker scoping to enforce boundaries that are difficult to keep clean in the current POC architecture. But the value comes from policy and tests, not from runtime branding.

If the plan above is followed, Kato can present a credible corporate security posture for local-first conversation capture and export.

## Resolved Decisions (2026-02-21)

1. Destination isolation:
  - Yes, spawn a new writer worker each time `record/capture` destination changes.
  - Security impact: helpful. It narrows write privileges to one target file per active worker, reducing blast radius if command parsing or writer logic is compromised.
2. Encryption at rest:
  - Deferred for v1.
  - Rationale: source chat logs are already unencrypted in common setups; prioritize path controls, permission boundaries, and auditability first.
3. Backward compatibility:
  - Not required.
  - Use strict command grammar by default and define allowed destinations in config/policy.
4. Platform target for first corporate release:
  - No mandatory platform requirement.
  - Practical choice: ship Linux-first (fastest path for daemon/process controls), then add macOS and Windows after baseline is stable.
5. Policy ownership:
  - Phase 1: user-managed local policy file.
  - Future phase: centrally managed org policy files for enterprise deployment.

## Suggested Immediate Next Step

Implement Phase 0 first and codify it in `documentation/notes/task.2026-02-21-kato-deno-security-baseline.md` before starting code migration. This prevents security drift during the rewrite.
