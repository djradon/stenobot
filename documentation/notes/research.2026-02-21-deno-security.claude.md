---
id: vp5zxpjojico9yc4f4fsc4o
title: Kato Deno Security Plan
desc: ''
updated: 1771712406697
created: 1771712398577
---

# Plan to Reimplement Kato as a Deno-Native Application

## Executive Summary

Rebuilding Kato from Stenobot's proven foundations in Deno can deliver meaningful security and distribution improvements — but only if the design stays grounded in Kato's actual threat model. Kato is a **passive observer**: it reads LLM session files from well-known local paths, parses them, and writes Markdown to user-specified destinations. It does not execute AI-generated code or spawn untrusted processes. This simplifies the security picture considerably.

The concrete security wins from a Deno rewrite are:

1. **Explicit, auditable permission boundaries** — `deno compile` embeds `--allow-read` and `--allow-write` flags into the binary, making Kato's filesystem footprint legible in the binary artifact itself, not just in documentation.
2. **Per-provider worker isolation** — each provider monitor (claude-code, codex, etc.) can run as a Deno Worker with read access scoped to its session directory and write access scoped to configured output paths, limiting blast radius if a malformed session file triggers unexpected behavior.
3. **Reduced dependency surface** — Deno's standard library can replace several Stenobot runtime dependencies (chokidar, yaml, winston, nanoid), each of which currently represents an unaudited supply-chain risk.
4. **Single-binary distribution** — `deno compile` produces a self-contained executable with no runtime installation requirement, which is a concrete improvement over `npm install -g stenobot`.

The main risks to plan for are:

- **Output path injection**: In-chat commands (`::record @path`) are parsed from LLM-generated content. A malicious prompt could attempt to redirect recording output to a sensitive path. An explicit output path allowlist is the correct mitigation.
- **Broad filesystem read**: The daemon needs read access to all session source directories (`~/.claude/`, `~/.codex/`). Deno makes this explicit but cannot narrow it further without breaking functionality; this is inherent in the monitoring design.
- **Daemon privilege**: The daemon runs continuously with the user's full permissions. Deno's permission model scopes this at the runtime level, but defense-in-depth (systemd hardening on Linux, documented permission scope) remains advisable.
- **Fixed compile-time permissions vs. user-configured paths**: `deno compile` bakes permissions into the binary. If users configure non-default session directories, the compiled binary cannot read them. This is a real design constraint that requires a deliberate solution.

## What Stenobot Proved

Stenobot validated the core architecture that Kato should build on. These learnings should drive the rewrite, not be repeated from scratch.

**What worked well:**

- **Daemon + CLI split.** A long-running background daemon (PID file, log file, `start`/`stop`/`restart` lifecycle) combined with a one-shot CLI for manual exports is the right operational model. Users should not need to keep a terminal open.
- **Provider-based abstraction.** `claude-code` and `codex` have different session formats and file locations; a `Provider` interface with `discoverSessions`, `parseMessages`, and `resolveWorkspaceRoot` separates these cleanly and is the right abstraction for adding future providers (Gemini, Kimi, etc.).
- **File watching semantics.** Chokidar's `awaitWriteFinish` (stabilization threshold + poll interval) prevents processing half-written JSONL files. This logic must be preserved; `Deno.watchFs()` handles the underlying events, but the stabilization logic will need to be reimplemented.
- **In-chat command parsing.** Detecting `::record`, `::capture`, `::export`, `::stop` from user message content is a genuine UX win. Commands are extracted from only the first line of user messages, reducing false positives from quoted or explanatory text.
- **Session deduplication.** Processing a session only when it is not already being processed (`processingSession` set) prevents concurrent duplicate runs that would corrupt incremental export state.

**What needs improvement:**

- **Output path injection is unmitigated.** The current `resolveOutputPath` handles `@` prefix stripping, `~` expansion, workspace root detection, and redundant-prefix stripping — but there is no allowlist check. A path like `::record @/etc/cron.d/malicious` would be resolved and written to if the daemon has write access there.
- **No explicit permission scope.** The Node.js daemon runs with full user permissions. Nothing in the code or distribution documents what filesystem paths it actually touches.
- **Heavy dependency tree.** 10+ runtime dependencies (chokidar, winston, yaml, zod, nanoid, chalk, date-fns, date-fns-tz, prompts, @stricli/core) means 10+ supply-chain attack surfaces with no lockfile integrity enforcement.
- **Build chain friction.** The `tsc` (typecheck) + `tsup` (bundle) + `tsx` (dev runner) pipeline requires three different tools. Deno's built-in TypeScript eliminates this entirely.
- **State is not integrity-verified.** The state file (`~/.stenobot/state.json`) controls which sessions are being recorded and to which paths. It is loaded and trusted without validation.
- **No enforcement of "no network."** Stenobot never contacts external services by design, but nothing enforces this. A compromised dependency could make outbound connections silently.

## Kato's Actual Threat Model

Understanding what Kato is and is not helps scope the security work correctly. Kato is a **passive local tool**, not an AI agent platform.

**What Kato does:**
- Reads provider session files (JSONL) from fixed, known locations (`~/.claude/projects/`, `~/.codex/sessions/`)
- Parses those files and extracts conversation messages
- Monitors them for changes using filesystem watching
- Writes Markdown to user-specified paths
- Responds to in-chat commands embedded in LLM conversation content

**What Kato does not do (and should enforce that it does not):**
- Execute code from session files
- Contact external services
- Spawn subprocesses based on session content
- Run user-supplied plugins or scripts

**Threat vectors:**

| Threat | Vector | Current posture | Recommended mitigation |
|--------|--------|-----------------|------------------------|
| Output path injection | `::record @../../sensitive.md` in LLM-generated content | Partial guards (workspace resolution) but no allowlist | Validate resolved path against configured output allowlist before any write |
| Malformed session file | Crafted JSONL crashes parser | Single process; parser crash affects all sessions | Per-provider worker isolation; catch and log parse errors per-session |
| Config file tampering | Malicious `~/.kato/config.yaml` redirects recordings | Config is parsed and trusted | Document config as trust boundary; validate config schema on load |
| Dependency supply chain | Compromised package introduces malicious code | No lockfile integrity enforcement; 10+ runtime deps | `deno.lock` with `--frozen`; prefer standard library over third-party packages |
| Daemon over-privilege | Daemon runs with full user permissions | No explicit scoping; anything Node.js can do, so can the daemon | `--allow-read`/`--allow-write` at runtime; `--deny-net --deny-run` explicitly |
| State file tampering | Modified state redirects recording to attacker-controlled path | State loaded and trusted without validation | Validate state schema on load; write state atomically |
| Unintended network access | Compromised dependency makes outbound calls | No enforcement | `--deny-net` enforced in binary |

**What Deno's permission model does and does not solve:**

Deno's deny-by-default permissions make Kato's filesystem footprint explicit and auditable, and `--deny-net` provides real enforcement of the no-network invariant. However:
- `--allow-read=~/.claude` grants access to **all** Claude conversations, not just the one being exported. This is inherent in the session monitoring design and cannot be scoped further without breaking the multi-session daemon.
- Runtime permission enforcement is implemented in the Deno runtime, not the OS kernel. It is a meaningful layer but not equivalent to a syscall-level sandbox.
- Workers cannot have more permissions than their parent process. Provider-level worker isolation is defense-in-depth, not a hard isolation boundary.

## Goals and Constraints

### Security goals

- **Explicit permission boundaries**: Every path Kato reads from or writes to should be documented, justified, and enforced via Deno permission flags.
- **No network access — enforced, not assumed**: Use `--deny-net` to make this a runtime invariant, not just an absence of networking code.
- **Output path allowlisting**: Paths derived from in-chat commands must be validated against a configured allowlist before any write operation.
- **Minimal dependency surface**: Prefer Deno standard library equivalents over third-party packages (file watching, YAML, logging, path manipulation, assertions).
- **Defense in depth**: Assume runtime permission enforcement is imperfect; add output path validation, schema validation on config and state load, and structured per-session error handling.
- **Supply-chain integrity**: Enforce `--frozen` lockfile semantics in CI and in the compiled binary build.

### Product goals preserved from Stenobot

- Local-first: all data stays on the user's machine
- Daemon + CLI operational model (start/stop/restart/status)
- Provider-based session monitoring (claude-code, codex, and future providers)
- In-chat commands for recording control (`::record`, `::capture`, `::export`, `::stop`)
- Markdown-native output with optional YAML frontmatter preservation
- Cross-platform (Windows, macOS, Linux)
- `kato init` generates a commented config; daemon auto-generates config if missing

### Constraints

- **No network access** — Kato operates entirely locally; this is enforced not just unimplemented
- **Cross-platform by default** — cannot rely on Linux-only primitives (namespaces, bubblewrap) as the default isolation mechanism; OS-specific hardening is an optional layer
- **Output targets are user-controlled but must be validated** — users specify output paths via in-chat commands or CLI flags; these must be checked against an allowlist before writing
- **Daemon must be resilient** — a parse error in one session must not crash the daemon or stop monitoring of other sessions
- **Compiled binary permission tension** — `deno compile` bakes permissions in; custom session directories require either a broader compile-time grant or a deliberate design choice (see below)

### Resolving the compile-time permission tension

When `deno compile` bakes `--allow-read` into the binary, users cannot read from paths not included at compile time. Options:

1. **Compile with a broader read grant** (e.g., `--allow-read=$HOME`) — simple, but less precise; documents at least that Kato does not read outside home.
2. **Grant read for all well-known defaults** (all default session directories across supported providers) — precise for default configurations but breaks for users with custom paths.
3. **Require the user to re-run with additional flags** for custom paths — breaks the "just install and run" UX.
4. **Read session directories from config, then prompt for permission expansion** at startup — requires `--allow-prompt` or an interactive flow; adds complexity.

**Recommendation**: Start with option 2 (all default paths) for the compiled binary, document it clearly, and provide a `kato run` task in `deno.json` for users with non-standard configurations.

## Rationale for Deno vs Node vs Bun

### Security posture

**Deno** defaults to deny-all for filesystem, network, and subprocess access. Fine-grained `--allow-read` and `--allow-write` flags can be scoped to specific paths. `--deny-net`, `--deny-run`, `--deny-ffi`, and `--deny-sys` make denials explicit even in development. Workers support per-worker permission configuration for provider-level isolation. `deno compile` embeds the permission flags into the binary. `deno.lock` with `--frozen` enforces supply-chain integrity.

**Node** now has a permission model, but Node's own documentation states it is not a full security boundary against malicious code, and it has had documented bypass vulnerabilities. npm has no equivalent to Deno's frozen lockfile for runtime permission enforcement. The `--build-sea` (Single Executable Application) feature is still experimental.

**Bun** does not currently ship a Deno-style permission sandbox; enforcing access restrictions requires OS-level tooling. Bun has strong performance and a compile story, but permission enforcement would be an entirely custom layer.

**For Kato's use case**: Deno is the clearest fit. Kato's permission surface is well-defined (read a small set of directories, write to configured output paths, no network, no subprocesses). Deno can express and enforce this precisely, and the enforcement is visible in the shipped binary.

### Distribution ergonomics

`deno compile` produces a self-contained single binary with no Node runtime required. The permission flags are embedded in the binary, making the tool's filesystem scope inspectable without reading source code. This addresses a practical corporate concern: "what exactly does this binary do to my filesystem?"

Compared to the current Stenobot distribution (`npm install -g stenobot`), a compiled Kato binary:
- Requires no runtime (Node, Deno, npm) on the target machine
- Documents its filesystem scope in the binary itself
- Can be signed and notarized for macOS Gatekeeper / Windows SmartScreen

### Developer experience

Deno's built-in TypeScript support eliminates the tsx/tsc/tsup toolchain. The built-in formatter, linter, test runner, and coverage tool reduce the dev dependency footprint. The Deno standard library (`@std/`) provides:
- `@std/path` — replaces Node's `node:path`
- `@std/yaml` — replaces the `yaml` npm package
- `@std/log` — replaces Winston
- `Deno.watchFs()` — replaces chokidar (with custom stabilization logic)
- `@std/assert` — replaces ad-hoc test assertions
- `crypto.randomUUID()` — replaces nanoid for ID generation

## Architecture Recommendation

### Single daemon process with per-provider workers

Kato runs as a single daemon process (equivalent to Stenobot's `SessionMonitor`) with one Deno Worker per enabled provider. The main process handles CLI, config, state, and worker lifecycle. Each worker handles one provider's session discovery and parsing.

```
┌─────────────────────────────────────────────────────────────────┐
│ kato daemon (main process)                                      │
│   read: ~/.kato, ~/.claude/projects, ~/.codex/sessions, ...     │
│   write: ~/.kato, <allowlisted output dirs>                     │
│   net: none  run: none  ffi: none                               │
│                                                                 │
│  ┌──────────────────┐     ┌──────────────────┐                 │
│  │ claude-code       │     │ codex worker     │                 │
│  │ Worker            │     │                  │                 │
│  │ read: ~/.claude   │     │ read: ~/.codex   │                 │
│  │ write: outputs    │     │ write: outputs   │                 │
│  └──────────────────┘     └──────────────────┘                 │
│                                                                 │
│  ┌─────────────────────────────────────────┐                   │
│  │ State + Config + Output Path Validator  │                   │
│  └─────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

Worker isolation is defense-in-depth, not a hard boundary: the parent process must hold the union of all worker read permissions, and a compromised parent can still access all paths. The benefit is that a crash or runaway error in one worker does not crash the main process or affect other providers.

### Output path validation

All paths derived from in-chat commands must pass validation before any write. The validator should:

1. Resolve the full absolute path (handle `@` prefix, `~` expansion, `path.sep`-prefix stripping for VSCode @-mentions, workspace root detection)
2. Check the resolved path against a configured allowlist of writable directory trees
3. Reject paths outside the allowlist, log the rejection with the raw command and resolved path, and continue monitoring — do not crash the daemon

The allowlist should default to:
- The workspace root of the current session (detected via git or common patterns)
- Any directories explicitly listed in `~/.kato/config.yaml` under `outputAllowlist`

This closes the prompt injection → path traversal vector without requiring users to pre-specify every possible output file.

### State integrity

The daemon's state file controls which sessions are being recorded and to which paths. In Kato:
- Write state atomically (write to a temp file in the same directory, then `Deno.rename()`)
- Validate state schema on load using Zod or equivalent; reject malformed state and start fresh rather than silently inheriting bad values
- Log all state mutations at INFO level: when a recording starts, stops, or changes output path

### File watching

`Deno.watchFs()` provides the underlying events. The stabilization logic from Stenobot (wait for writes to cease for 500ms before processing) must be reimplemented, since Deno's native watcher fires events immediately. A simple debounce per session file path is sufficient.

## Permission Model

### Filesystem permission matrix

| Component | Read | Write | Net | Run |
|-----------|------|-------|-----|-----|
| Main daemon process | `~/.kato/`, all configured session dirs | `~/.kato/`, allowlisted output dirs | none | none |
| claude-code worker | `~/.claude/projects/`, `~/.claude-personal/projects/` | allowlisted output dirs | none | none |
| codex worker | `~/.codex/sessions/` | allowlisted output dirs | none | none |
| `kato export` (one-shot) | source session dir | stdout or specified output file | none | none |
| `kato status` / `kato init` | `~/.kato/` | `~/.kato/` | none | none |

No component needs: `--allow-net`, `--allow-run`, `--allow-ffi`, `--allow-sys`, or broad `--allow-env`.

### Development run

```bash
deno run \
  --no-remote --cached-only --frozen --lock=deno.lock \
  --no-prompt \
  --allow-read="$HOME/.kato,$HOME/.claude/projects,$HOME/.claude-personal/projects,$HOME/.codex/sessions" \
  --allow-write="$HOME/.kato" \
  --deny-net --deny-run --deny-ffi \
  src/main.ts
```

Note: `--allow-write` at runtime is limited to `~/.kato`. Output to user workspace directories happens only after allowlist validation; those paths will need to be in the compiled binary's grant or handled via runtime permission expansion.

### Compile-time binary (using option 2: all well-known defaults)

```bash
deno compile \
  --no-remote --cached-only --frozen --lock=deno.lock \
  --allow-read="$HOME/.kato,$HOME/.claude/projects,$HOME/.claude-personal/projects,$HOME/.codex/sessions" \
  --allow-write="$HOME/.kato,$HOME" \
  --deny-net --deny-run --deny-ffi \
  --target x86_64-unknown-linux-gnu \
  --output dist/kato \
  src/main.ts
```

The `--allow-write=$HOME` is broader than ideal but reflects the reality that users can direct recording output anywhere in their home directory. The allowlist validation in the application code provides the meaningful restriction; the Deno permission grant defines the outer boundary.

### Worker permission sketch

```ts
const claudeWorker = new Worker(
  new URL("./providers/claude-code/worker.ts", import.meta.url),
  {
    type: "module",
    deno: {
      permissions: {
        read: claudeSessionPaths,   // e.g., ["~/.claude/projects"]
        write: allowlistedOutputDirs,
        net: false,
        env: false,
        run: false,
        ffi: false,
        sys: false,
      },
    },
  },
);
```

## Migration Roadmap

The roadmap is structured as security deliverables alongside product deliverables. Shipping features without the corresponding security outputs does not improve the security posture.

| Milestone | Product deliverables | Security deliverables |
|-----------|---------------------|----------------------|
| 1. Threat model + spec | Written spec for workspace root, provider model, in-chat command semantics | Written threat model; output path allowlist design; permission matrix as a committed artifact |
| 2. Deno scaffold | `deno.json` tasks; lockfile policy; CI pipeline; baseline CLI skeleton; `~/.kato/` initialization | No-network CI check (`--deny-net`); `--frozen` lockfile gate; dependency audit |
| 3. Provider data model | Port `Provider` interface; JSONL parsers for claude-code and codex; session discovery; workspace root detection | Fuzz session file parser; golden-file export tests; path traversal tests in workspace resolution |
| 4. Daemon + worker isolation | Worker launcher; per-provider workers with scoped permissions; `Deno.watchFs()` with stabilization; state management (atomic writes, schema validation) | Cross-provider read isolation test; state tampering test; worker crash recovery test |
| 5. In-chat command handling | Port `::record`, `::capture`, `::export`, `::stop` detection; output path resolution | Output path allowlist enforcement tests; path injection test suite; `::stop` removes recording state test |
| 6. Distribution | `deno compile` single-binary builds for Linux/macOS/Windows; reproducible build pipeline with `--frozen`/`--no-remote` | Binary permission verification; offline run test; no-network integration test |
| 7. Optional daemon hardening (Linux) | systemd unit file | `PrivateNetwork=yes`, `ProtectSystem=strict`, `NoNewPrivileges=yes`, `ReadWritePaths=` for configured output dirs |

### CI/CD recommendations

Minimum CI gates (aligned to Deno ergonomics):

- `deno fmt --check` and `deno lint` on every PR
- `deno test` with unit and integration tests; use per-test permission scopes in test definitions
- `--frozen` lockfile check to catch unexpected new dependencies
- A "no network" integration test: run the daemon with explicit `--deny-net` and verify it operates normally
- An "output path allowlist" integration test: attempt to write to a path outside the allowlist via a synthetic in-chat command; verify it is rejected with a warning, not written

### Starter `deno.json`

```jsonc
{
  "name": "kato",
  "version": "0.1.0",
  "imports": {
    "@std/cli": "jsr:@std/cli@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "@std/log": "jsr:@std/log@^0.224.0",
    "@std/assert": "jsr:@std/assert@^1.0.0",
    "zod": "npm:zod@^3.22.0"
  },
  "lock": { "frozen": true },
  "tasks": {
    "fmt": "deno fmt",
    "fmt:check": "deno fmt --check",
    "lint": "deno lint",
    "test": "deno test",
    "dev": "deno run --no-remote --cached-only --frozen --lock=deno.lock --no-prompt --allow-read=$HOME/.kato,$HOME/.claude/projects,$HOME/.claude-personal/projects,$HOME/.codex/sessions --allow-write=$HOME/.kato,$HOME --deny-net --deny-run --deny-ffi src/main.ts",
    "build:linux": "deno compile --no-remote --cached-only --frozen --lock=deno.lock --allow-read=$HOME/.kato,$HOME/.claude/projects,$HOME/.claude-personal/projects,$HOME/.codex/sessions --allow-write=$HOME/.kato,$HOME --deny-net --deny-run --deny-ffi --target x86_64-unknown-linux-gnu --output dist/kato src/main.ts",
    "build:mac": "deno compile --no-remote --cached-only --frozen --lock=deno.lock --allow-read=$HOME/.kato,$HOME/.claude/projects,$HOME/.claude-personal/projects,$HOME/.codex/sessions --allow-write=$HOME/.kato,$HOME --deny-net --deny-run --deny-ffi --target aarch64-apple-darwin --output dist/kato-mac src/main.ts",
    "build:win": "deno compile --no-remote --cached-only --frozen --lock=deno.lock --allow-read=$HOME/.kato,$HOME/.claude/projects,$HOME/.claude-personal/projects,$HOME/.codex/sessions --allow-write=$HOME/.kato,$HOME --deny-net --deny-run --deny-ffi --target x86_64-pc-windows-msvc --output dist/kato.exe src/main.ts"
  }
}
```

Zod is retained for config and state schema validation, where the cost of a third-party dependency is justified by the value of strict runtime type checking at trust boundaries.

## Isolation Strategy Comparison

| Strategy | Isolation strength | Cross-platform | Dev productivity | When to use |
|----------|-------------------|----------------|-----------------|-------------|
| No isolation (single process) | Weak — one bug affects everything | Best | Best | Never for Kato |
| In-process workers with scoped permissions | Runtime-enforced, not kernel-enforced | Good — Deno workers are cross-platform | Good | Recommended default for Kato |
| Separate OS processes with sandboxing | Kernel-enforced on Linux (namespaces); inconsistent on Windows/macOS | Poor | Medium | Optional hardening layer on Linux |
| systemd unit hardening | OS-enforced filesystem and network restrictions | Linux only | Low overhead once configured | Recommended for Linux server deployments |

## Optional Linux Daemon Hardening

For users deploying Kato as a persistent system service on Linux, a systemd unit with sandboxing directives provides kernel-level enforcement beyond what Deno's runtime permissions can offer.

Illustrative unit file (tune to actual output paths):

```ini
[Unit]
Description=Kato conversation monitor daemon

[Service]
ExecStart=/usr/local/bin/kato start --foreground
Restart=on-failure

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.kato %h/notes %h/hub
PrivateNetwork=yes

[Install]
WantedBy=default.target
```

`PrivateNetwork=yes` is a kernel-level enforcement of the no-network invariant, providing defense-in-depth beyond Deno's `--deny-net`. `ProtectHome=read-only` with explicit `ReadWritePaths=` allowlist provides kernel-level write scope enforcement beyond the application's own validation.

## Notes on the ChatGPT Source Analysis

The original ChatGPT analysis was produced without access to Stenobot's code, documentation, or conversation history. The following significant corrections were made in this rewrite:

1. **Stagecraft content removed entirely.** The original report devoted substantial space to a "run arbitrary code" use case that is not part of Kato's roadmap. All references have been removed.

2. **Corrected threat model.** The primary risks for Kato are output path injection (from in-chat command parsing), broad-but-explicit filesystem read (inherent in session monitoring), and dependency supply chain — not AI agent sandbox escapes or untrusted code execution.

3. **Worker framing corrected.** Workers in Kato are per-provider session monitors, not per-AI-agent sandboxes. The isolation benefit is provider-level blast-radius reduction, not agent containment.

4. **Stenobot learnings incorporated.** The rewrite is grounded in what Stenobot actually proved and where its specific weaknesses lie, rather than a greenfield analysis of "Deno for local-first tools" in the abstract.

5. **Compile-time permission tension surfaced.** The original report recommended `--allow-read=~/.kato` without noting that `deno compile` bakes permissions in, which breaks non-default session directory configurations. This design constraint is explicitly addressed.

6. **CVE references removed.** The original report cited specific Node CVE numbers without verifiable sourcing. The general point — that Node's permission model has documented weaknesses — is retained, but reliance on potentially unverifiable CVE claims is not.

7. **Export-via-stdout framing removed.** The original report recommended designing export to use stdout to minimize `--allow-write` scope. This does not match Kato's incremental file-based recording model; recommendations are grounded in actual usage patterns.
