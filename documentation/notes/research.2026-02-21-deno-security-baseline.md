---
id: 2z3t8mvw3i9hq8xj3g6n2kc
title: 2026 02 21 Deno Security Baseline
desc: 'Unified security baseline for Kato Deno rewrite'
updated: 1771719418494
created: 1771719418494
---
# Kato Deno Security Baseline (Unified)

## Purpose

This is the final unified security baseline for the Kato rewrite in Deno.

It merges the strongest parts of the Codex, Claude, and Gemini drafts, and incorporates the current product decisions made on February 21, 2026.

## Executive Summary

Kato should be treated as a **passive observer** system, not an autonomous execution platform.

Kato reads local LLM session logs, parses them, and writes Markdown outputs. It should not execute user or model code, should not require network access for core operation, and should keep permissions explicit and auditable.

The rewrite is justified if we get these concrete outcomes:

1. Explicit runtime permission boundaries (read/write/net/run/env/ffi/sys) with deny-by-default behavior.
2. Safer write surface through destination allowlisting and destination-scoped writer isolation.
3. Lower supply-chain and operational risk through a Deno-native toolchain and policy-driven architecture.
4. A reproducible, reviewable security posture suitable for corporate review.

## System Scope and Threat Model

### In scope

- Provider session discovery (`claude-code`, `codex`, later others).
- Session parsing and incremental processing.
- In-chat command handling (`::record`, `::capture`, `::export`, `::stop`).
- Controlled Markdown export writes.
- Local daemon lifecycle and state persistence.

### Out of scope (baseline)

- Arbitrary code execution from chat content.
- Plugin/script execution loaded from chats.
- Network-dependent processing for core local capture/export.

### Primary threats

1. Output-path injection from in-chat command text.
2. Over-broad filesystem permissions at runtime.
3. Parser instability or poisoning via malformed session logs.
4. State/config tampering that alters behavior silently.
5. Dependency/supply-chain drift.

## Security Principles

1. Deny by default.
2. Least privilege per process/worker.
3. Explicit policy over implicit behavior.
4. Deterministic path validation before every write.
5. Crash-safe persistence and observable audit trails.
6. Secure defaults first; compatibility features must be opt-in.

## Architecture Baseline

### 1) Orchestrator process

The orchestrator is responsible for policy load, worker lifecycle, and state management.

Required properties:
- No network.
- No subprocess execution.
- No provider parser logic in orchestrator beyond routing and control.
- Never writes outside policy-approved roots.

### 2) Provider parser workers

One worker per provider class (`claude-code`, `codex`, etc.).

Required properties:
- Read-only access to provider session roots.
- No write permission to arbitrary destinations.
- No network/run/ffi/sys.
- Failures isolated from other providers.

### 3) Destination-scoped writer workers

A new writer worker is spawned when a `record/capture` destination changes.

Required properties:
- Write permission scoped to one destination target (or minimally its parent directory if append strategy needs temp+rename).
- No provider session read permission.
- Rotated on destination changes.
- Old worker terminated immediately after successful handoff.

Security impact:
- This is helpful and recommended. It narrows write blast radius significantly compared with a single long-lived writer that can access many paths.

## Filesystem and Path Policy Baseline

### Managed roots

- `~/.kato/config/`
- `~/.kato/state/`
- `~/.kato/logs/`
- `~/.kato/exports/`

### Path validation rules (mandatory)

1. Canonicalize using realpath-equivalent before allow/deny decision.
2. Reject traversal escapes (`../`, mixed-separator evasions, UNC/extended path edge cases unless explicitly allowed).
3. Reject symlink escapes outside approved roots.
4. Apply policy check after path normalization, before write.
5. Log all denied write attempts with decision reason and policy version.

### Destination allowlist model

- Strict command grammar by default.
- Allowed destinations come from policy/config.
- No backward-compatibility requirement for permissive legacy command parsing.

## Permission Profiles

### Daemon profile

- Read: configured provider session roots + `~/.kato/config` + `~/.kato/state`.
- Write: `~/.kato/state`, `~/.kato/logs`, policy-allowed export roots.
- Deny: net/run/env/ffi/sys by default.

### One-shot export profile

- Read: one session source + policy/config.
- Write: one explicit output target.
- Deny: net/run/env/ffi/sys.

### Destination-scoped writer worker profile

- Read: none (payload arrives through message channel).
- Write: one destination (or minimal parent dir when atomic append requires it).
- Deny: net/run/env/ffi/sys.

## Compile-Time Permission Tension (Distribution UX)

`deno compile` bakes permissions into binaries. That creates a tradeoff:
- Tight compile-time permissions improve auditability.
- User-configured non-default provider paths may fail without broader read grants.

### Evaluated options

1. Broad read grant (for example all of home directory).
2. Default provider roots only (tighter, but may miss custom setups).
3. Require users to run with expanded permissions for custom paths.
4. Interactive permission expansion flow.

### Baseline decision

Use default provider roots as compiled baseline and document clear override paths for custom configurations.

Keep this explicit in release docs so enterprise reviewers understand the operational contract.

## Platform Strategy

No platform is mandatory for first corporate release.

Practical implementation strategy:
1. Linux-first initial corporate release (fastest for daemon/process hardening and service management).
2. Add macOS and Windows once baseline controls and test harness are stable.

## Encryption at Rest

Deferred for v1 baseline.

Rationale:
- Source chat logs are commonly unencrypted already.
- Higher-value initial controls are permission boundaries, path policy, auditability, and parser hardening.
- Revisit for enterprise/cloud profiles and remote storage scenarios.

## Policy Ownership Model

### Phase 1

User-managed local policy file.

### Future enterprise phase

Centrally managed org policy files (enforced and not user-overridable for protected settings).

## Supply Chain and Build Integrity Baseline

1. Lockfile required and frozen in CI.
2. Offline/cached-only build mode for release builds where possible.
3. Minimal third-party dependency set; justify each non-stdlib dependency.
4. Signed release artifacts with provenance documentation.

## Auditability Baseline

Maintain two streams:

1. Operational log (`kato.log`) for lifecycle/health.
2. Security audit log (`security-audit.jsonl`) for policy decisions.

Security events should include at least:
- Event type.
- Session/provider identifier.
- Raw command token and normalized target path (when relevant).
- Allow/deny decision and reason.
- Policy version/hash.
- Worker/process identity.

## Required Security Test Gates

1. Path traversal and canonicalization tests.
2. Symlink escape tests.
3. Command confusion tests (strict grammar should reject prose-triggered commands).
4. Parser poisoning tests (malformed JSONL, oversized lines, weird schema transitions).
5. Permission boundary tests per worker type.
6. Daemon lifecycle race tests (double start, stale lock, abrupt kill).
7. Audit completeness tests (all policy decisions emitted).

## Implementation Phases (Security-Centric)

### Phase 0: Security baseline freeze

Deliverables:
- Threat model.
- Path policy spec.
- Command grammar spec.
- Permission matrix.
- Audit event schema.

### Phase 1: Parser/provider parity

Deliverables:
- Deno provider interfaces and parsers with fixture parity.
- Offset-resume parity and regression tests.

### Phase 2: Boundary enforcement

Deliverables:
- Path policy engine.
- Strict command parser.
- Destination-scoped writer worker lifecycle.

### Phase 3: Daemon hardening

Deliverables:
- Locking/state durability.
- Worker supervision/restart policies.
- Security audit stream.

### Phase 4: Distribution hardening

Deliverables:
- Reproducible compile pipeline.
- Signed artifacts.
- CI security gates.

## Useful Feature Ideas from Earlier Drafts

1. `kato --permissions` (or `kato doctor --permissions`) to print effective policy and runtime permission scope for audit review.
2. Optional Linux service hardening profile (`systemd` hardening directives) as defense in depth for server deployments.

Both are good ideas and should remain on the roadmap, but are not blockers for baseline v1.

## Planning-Time Reference Strategy (Temporary)

Using a temporary local, read-only, gitignored stenobot working tree as planning reference is acceptable if these guardrails are used:

1. Treat it as reference-only; no runtime coupling.
2. Do not import hidden local state/secrets/config from that tree.
3. Record the reference commit hash in planning docs for provenance.
4. Remove the reference folder before formal release hardening starts.

## Final Decision Statement

Proceed with the Deno rewrite.

Success criteria for calling Kato “corporate-ready baseline” are:
1. Destination-scoped write isolation and enforced path policy.
2. No-network/no-subprocess runtime posture by default.
3. Security audit trail with verifiable policy decisions.
4. Reproducible, signed release artifacts with documented permission scope.
