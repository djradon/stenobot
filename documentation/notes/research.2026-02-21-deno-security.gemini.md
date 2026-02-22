---
id: b60kx8pfrsle8gjz6ofz0fb
title: 2026 02 21 Deno Security (Gemini Rewrite)
desc: 'Strategic plan for reimplementing Stenobot as Kato in Deno with a focus on corporate security.'
updated: 1740150000000
created: 1740150000000
---

# Plan to Reimplement Kato as a Deno-Native Application

## Executive Summary

Migrating Stenobot (to be renamed **Kato**) to Deno is a strategic move to transition from a "proof-of-concept" chat logger to a corporate-ready security tool. The primary value of this rewrite is not just a change in runtime, but the adoption of a **hardened permission model** that is visible, auditable, and enforceable.

Kato is fundamentally a **passive observer**. It monitors local LLM session logs, parses them, and exports structured Markdown. Unlike "AI agents" that execute code, Kato's primary security hazards are centered on local file access and the integrity of its parser.

**Key Security Wins with Deno:**
1.  **Binary-Embedded Permissions:** `deno compile` allows us to bake `--allow-read` and `--allow-write` flags directly into the standalone binary. This makes the tool's "blast radius" legible to corporate security auditors without requiring a source code review.
2.  **Explicit "No Network" Guarantee:** Using `--deny-net` as a runtime invariant ensures that Kato cannot exfiltrate conversation data, even if a third-party dependency is compromised.
3.  **Provider Isolation:** Deno Workers allow us to isolate log-parsing logic per provider (e.g., Claude Code, Codex). A malformed or malicious log entry in one session cannot crash the entire daemon or access another provider's data.
4.  **Supply Chain Rigor:** Replacing the heavy Node.js dependency tree (`chokidar`, `winston`, `yaml`, `zod`, etc.) with Deno's robust Standard Library and native TypeScript support significantly reduces the attack surface.

## Strategic Learnings from Stenobot

The Stenobot prototype successfully validated the core architecture. Kato will build upon these proven patterns while addressing identified security gaps.

### What Stays (The Foundation)
-   **Provider Abstraction:** The `Provider` interface (`src/providers/base.ts`) cleanly separates session discovery and parsing logic. This remains the core of the system.
-   **Offset-Based Incremental Parsing:** Reading logs by byte-offset ensures performance on large files and prevents redundant processing.
-   **In-Chat Command UX:** Detecting `::capture` and `::record` within LLM turns provides a seamless workflow that users value.
-   **Daemon Lifecycle:** The `start`/`stop`/`restart` model with PID/lock-file management is the correct operational approach for background monitoring.

### What Changes (The Hardening)
-   **Output Path Allowlisting:** Stenobot currently resolves paths from in-chat commands without an allowlist. Kato will enforce a mandatory write-root (e.g., `~/.kato/exports`) and reject any path traversal or absolute writes outside approved zones.
-   **Strict Command Grammar:** To prevent accidental command triggering from natural language, Kato will default to a stricter "line-start" grammar for in-chat commands in corporate profiles.
-   **Dependency Consolidation:** The rewrite will eliminate the need for `tsup`, `tsx`, and `chokidar`, moving to Deno's native toolchain.
-   **State & Config Validation:** All persistent state (`state.json`) and configuration will be schema-validated on load to prevent tampering or corruption from affecting daemon stability.

## Kato's Corporate Threat Model

Kato operates in a "high-confidentiality, low-privilege" environment. Its security posture must reflect this.

| Threat | Vector | Mitigation Strategy |
| :--- | :--- | :--- |
| **Output Path Injection** | Malicious prompt directs output to `~/.ssh/authorized_keys` | Strict allowlist validation; reject all paths outside configured export roots. |
| **Data Exfiltration** | Compromised dependency sends logs to external server | Mandatory `--deny-net` enforced at the runtime/binary level. |
| **Log Poisoning** | Malformed session JSONL crashes the parser | Isolate parsers in Deno Workers; implement robust error boundaries and anomaly logging. |
| **State Tampering** | Attacker modifies `state.json` to hijack recordings | Atomic writes; schema validation on load; file-level permissions (0600). |
| **Supply Chain Attack** | Malicious update to a nested dependency | `deno.lock` with `--frozen`; minimize 3rd-party deps by leveraging Deno's StdLib. |

## Proposed Architecture: Kato Deno-Native

### 1. The Orchestrator (Main Process)
The main process handles CLI commands, configuration loading, and overall lifecycle management.
-   **Permissions:** Restricted to Kato's home directory (`~/.kato`) and the union of necessary provider log directories.
-   **Responsibilities:** Spawning provider workers, managing the global `state.json`, and handling the output path allowlist.

### 2. Provider Agents (Deno Workers)
Each log source (Claude, Codex, etc.) is monitored by a dedicated Worker.
-   **Isolation:** Workers receive **read-only** access to their specific log directories.
-   **Safety:** If a parser crashes due to a corrupt log file, the Orchestrator can restart it without affecting other active recordings.

### 3. Distribution & Provenance
Kato will be distributed as signed, standalone binaries.
-   **Tool:** `deno compile`.
-   **Benefit:** Zero-dependency installation. Corporate users can verify the binary's checksum and signature before deployment.
-   **Transparency:** The binary itself reports its required permissions when queried (e.g., `kato --permissions`).

## Implementation Roadmap

### Phase 1: Foundation & CLI (Weeks 1-2)
-   Initialize Deno 2 project with `deno.json`.
-   Implement `kato init` and workspace setup (`~/.kato`).
-   Port the `Provider` registry and basic CLI infrastructure.
-   **Security Goal:** Establish the `--deny-net` CI gate.

### Phase 2: Secure Parsing & Monitoring (Weeks 3-4)
-   Port Claude and Codex parsers to Deno.
-   Implement `Deno.watchFs` with custom stabilization logic (replacing `chokidar`).
-   Deploy Provider Workers with scoped read permissions.
-   **Security Goal:** Pass 100% of existing parser fixtures in an isolated environment.

### Phase 3: Hardened Export & Commands (Weeks 5-6)
-   Implement the **Path Allowlist Validator**.
-   Harden the `Detector` for strict in-chat command parsing.
-   Add atomic state management and schema validation.
-   **Security Goal:** Complete the "Path Injection" and "Symlink Escape" regression test suite.

### Phase 4: Corporate Release (Week 7+)
-   Automate `deno compile` for Linux, macOS, and Windows.
-   Implement binary signing and notarization.
-   Generate corporate-facing security documentation (Permission Matrix).

## Final Recommendation: Why Deno?

Deno is the only modern runtime that treats **permissions as a first-class citizen**. For a tool like Kato, which handles sensitive conversation logs, the ability to prove "no network access" and "limited filesystem scope" is not just a feature—it is the core value proposition for corporate adoption. 

The rewrite should proceed immediately, leveraging the stable provider logic from Stenobot while upgrading the security substrate to meet enterprise standards.
