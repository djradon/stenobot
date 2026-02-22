---
id: b7xrx8bbgix5pc9p82dtqv6
title: Chatgpt
desc: ''
updated: 1771712350771
created: 1771711569322
---
# Plan to Reimplement Kato as a Deno‑Native Application

## Executive summary

Rebuilding Kato “from scratch” in Deno can deliver **real** security and distribution advantages, but only if you actively design around the two biggest traps in your current reasoning: (a) “no network” does **not** equal low risk, because local file access and process execution are the main hazards in local-first tools; and (b) a compiled binary is not inherently safer—it can just make capability boundaries easier to ship *if* you lock them down correctly. citeturn5view0turn3search0turn23search3

The most actionable security win you can get *early* is an **agent-per-chat isolation model** using Deno **workers with explicit per-worker permission sets** (read: only that chat file; write: only that output file; net: none in the initial mode). Deno’s Worker API supports restricting worker permissions, and workers cannot be granted permissions beyond their parent process. citeturn12search0turn12search7turn12search1

The biggest security risk to plan for is your future “Stagecraft runs arbitrary code” requirement: Deno’s permission model is valuable, but it is **not sufficient as a single layer** for executing untrusted code. Deno’s own security guidance explicitly recommends defense-in-depth (OS sandboxing and VM/MicroVM layers) for untrusted execution. citeturn14view1turn7search1turn7search2

A credible, rigorous default plan is:

- **Default architecture**: single local-first Kato process + **per-chat agent worker** (or worker pool) with *deny-by-default* permissions; no network; strict dependency locking; and an explicit Kato “workspace root” directory that contains all conversation state and outputs so filesystem permission scopes are clean and testable. citeturn5view0turn12search7turn13view2  
- **Hardening path**: add permission audit logging and targeted deny rules for privileged paths; build “permission-bypass” regression tests (symlink/path escape, `/proc` tricks, etc.). citeturn4search1turn16view1turn25view2  
- **Stagecraft path**: ship an “unsafe execution mode” only behind explicit UI/CLI affordances; implement either (a) local OS sandbox wrappers on Linux (bubblewrap/Firejail/systemd hardening), or (b) microVM execution (e.g., Deno Sandbox on Deploy) for true untrusted code isolation. citeturn8search0turn8search5turn22view0turn7search1

A note you should not ignore: both Deno and Node have seen **permission model bypass** vulnerabilities over time. Node’s permission model has had multiple documented bypass CVEs (including filesystem and Unix Domain Socket bypasses) and the Node docs explicitly warn that the permission model is not a security boundary against malicious code. citeturn10view0turn10view1turn1view2  
Deno has had permission-related advisories too (e.g., privileged file access leading to permission escalation) and real-world research has shown classes of weaknesses (static import behavior, symlink TOCTOU, “shadow permissions”). If you want to market “own your AI conversations,” you need a plan that assumes sandbox controls sometimes fail and still limits blast radius. citeturn16view1turn16view3turn25view0turn25view2

## Goals, constraints, and assumptions

### Product goals Kato must preserve

Kato’s stated direction implies at least five “non-negotiable” capabilities:

- **Local-first AI conversations** stored on the user’s machine with durable, inspectable exports/imports. This increases confidentiality requirements for local storage formats and file scoping. citeturn5view0turn14view1  
- **Installable CLI first**, with an optional GUI wrapper. Deno’s CLI tooling and compilation targets make this feasible, but GUI strategy is an explicit design choice (wrapper vs embedded UI server vs native). citeturn3search30turn23search3  
- **Export/import** paths that can be run non-interactively (CI, scripts) without accidentally broadening permissions. Deno’s sandbox-by-default behavior makes this easier to reason about if you design exports to use stdout and imports to use stdin (minimize file permissions). citeturn5view0turn4search5  
- **Agent-per-chat model**: you want to spawn agents that only access “their chat” and “their output.” Deno worker permissions (or subprocess + OS sandbox) are the most direct mapping. citeturn12search7turn12search0turn14view1  
- **Stagecraft future**: eventually execute arbitrary code. This requires a separate execution substrate, because a runtime permission model is not robust enough on its own for adversarial code. citeturn14view1turn7search1turn7search2

### Security goals you should be explicit about

If you do not formalize these now, “starting from scratch” will drift into a rewrite that doesn’t measurably improve security.

- **Containment**: compromise of one agent (prompt injection, malicious plugin, supply chain) should not compromise other chats, user secrets, or system integrity. citeturn14view1turn25view0  
- **Least privilege**: default deny for net/run/env/ffi/sys; explicit allowlists for read/write; no “just use `-A`” habits. Deno defaults to running with no disk/net/subprocess access. citeturn5view0turn4search5turn14view0  
- **Defense in depth**: assume runtime permission enforcement can be bypassed sometimes; use lockfiles and offline dependency modes; add OS sandboxing or microVM options for truly untrusted code. citeturn14view1turn13view2turn25view0  
- **Safe distribution**: reproducible builds and clear, fixed capability boundaries for binaries (or explicit prompts) with code signing where appropriate. Deno compile preserves runtime flags into the binary; Node SEA suggests signing; Deno’s compile story has been evolving to support code signing via its embedding mechanism. citeturn3search30turn10view2turn23search3turn23search9

### Constraints and unknowns

- **OS targets are unspecified**: you should avoid architecture choices that require Linux-only primitives as the default isolation layer, even though Linux can be your “paranoid mode.” citeturn14view1turn22view0  
- **User base size is unknown**: distribution pipeline should support (a) one-person releases and (b) eventual automated artifact publishing. Deno’s CI docs explicitly support fmt/lint/test/coverage workflows and link to a Deno starter workflow for Git-based CI. citeturn18search0  
- **Deno LTS is ending soon (April 30, 2026)**, which is a planning risk: you’ll need a discipline for version pinning and upgrades rather than relying on “LTS forever.” citeturn18search2

## Rationale for choosing Deno vs Node vs Bun

This section is intentionally blunt: none of these runtimes automatically gives you “secure agents.” You only get security if the runtime’s guardrails align with your product architecture and you continuously test boundaries.

### Security posture and sandbox model

**Deno**

- Defaults to a sandbox with **no disk, network, or subprocess access** unless flags grant it. citeturn5view0turn4search5  
- Provides **fine-grained allow and deny** flags for env/net/read/write/run/ffi/sys and supports audit logs and permission tracing. citeturn14view0turn4search1turn4search8  
- Supports **worker-level permission configuration**, enabling internal agent isolation without subprocess spawning. citeturn12search7turn12search0  
- Also includes advanced mechanisms like a **permission broker** (external policy engine) that can centralize and enforce permission decisions (and forces the process to terminate if brokering fails). citeturn14view0  
- However, Deno’s permission system has had vulnerabilities and edge cases (e.g., privileged OS file paths granting unintended “shadow” permissions; symlink/path issues), so you must treat it as a layer, not a boundary. citeturn16view1turn16view3turn25view0turn25view2  

**Node**

- Now has a **permission model** with CLI flags and API support, but Node’s own documentation emphasizes it is not a full security boundary (“malicious code can bypass limitations”). citeturn1view2  
- Node has had multiple permission bypass CVEs and advisories, including filesystem permission bypass via crafted symlinks (CVE-2025-55130), Unix Domain Socket bypass of net restrictions (notably affecting permission model users), and earlier bypasses in the experimental era. citeturn10view0turn10view1  

**Bun**

- Bun has strong performance and a packaging story (`bun build --compile`) but **does not currently ship a Deno-style permission sandbox**; the existence of multiple open feature requests explicitly asking for a Deno-compatible permission model is strong evidence you would be building your own sandbox story out of OS tooling. citeturn17view2turn17view3  
- Bun is investing in supply-chain controls (e.g., Security Scanner API) but that is a different layer than runtime containment. citeturn17view4  

**Bottom line**: For Kato’s “agent-per-chat” containment, Deno is the only one of the three with a mature, first-class “permissions everywhere” mindset plus worker-level permission scoping that fits your model directly. Node’s permission model is improving but has a track record of bypasses in exactly the areas you’d rely on. Bun presently lacks this class of runtime sandbox. citeturn12search7turn10view0turn17view2

### Distribution and deployment ergonomics

**Deno compile**

- Produces a **self-contained executable** and preserves runtime-affecting flags in the resulting binary. citeturn3search30turn23search3  
- Supports cross-target builds via `--target`, and supports dependency integrity modes like `--lock`, `--frozen`, and offline behaviors like `--cached-only` / `--no-remote` during compilation. citeturn19view4turn3search30  
- Deno leadership has described compile’s evolution including code-signing considerations and the embedding approach used to support signing. citeturn23search3turn23search9  

**Node SEA**

- Node now supports building Single Executable Applications (SEA) with `--build-sea` and provides guidance including signing steps. citeturn10view2  
- SEA is still labeled experimental in the API docs and implies additional build complexity relative to Deno’s “compile the script” mental model. citeturn10view2  

**Bun compile**

- Bun can build executables and explicitly documents that the executable contains a copy of the Bun binary. citeturn17view1  
- Bun provides explicit documentation for `codesign` workflows on macOS executables built with `--compile`. citeturn23search2  

**Critical observation**: Your security story depends on how “fixed” the shipped binary’s capabilities are. Deno compile’s “flags get preserved into the binary” concept is extremely aligned with your least-privilege narrative—*but only if you can keep permissions narrow while still supporting real user workflows.* citeturn3search30turn23search3

### Developer experience and maintainability

Deno’s built-in toolchain matters because you’re proposing a full restart.

- Deno projects can standardize dependency integrity with `deno.lock` and `--frozen` semantics. citeturn13view2turn5view0  
- Deno provides built-in linting, formatting, testing, coverage, and CI guidance. citeturn11search0turn11search1turn18search0  
- The sharp edge: Deno’s release channels and impending LTS discontinuation mean you must plan upgrades rather than trusting a long-term frozen baseline. citeturn18search2  

## Architecture options and recommended default

This section gives three architecture families plus a recommended default. The key is choosing the one where your security goals *actually hold*, not the one that sounds most elegant.

### Option A: Single process with worker‑scoped permissions

Use one Kato process for storage/index/UI + spawn one Deno Worker per chat agent. Each worker runs your agent logic, but with permissions restricted to that chat file and that output file.

**Pros**

- Strong alignment with your mental model: “agent only sees its chat + output.” Worker permissions are explicitly supported. citeturn12search7turn12search0  
- Avoids `--allow-run` for subprocess spawning (which Deno warns can effectively escape sandbox constraints). citeturn14view0turn16view1  
- Cross-platform (not dependent on Linux-only sandbox tools). citeturn12search7  

**Cons / threat-model implications**

- Workers cannot have more permissions than the parent, so the parent process must hold the **union** of permissions needed by all workers. This means a compromise of the parent (or shared libraries in-process) can still pivot to broader access. citeturn12search0  
- Deno’s permissions are an enforcement layer in the runtime, not a kernel boundary; historical vulnerabilities show you should still implement defense-in-depth and regression tests. citeturn16view1turn25view0  

**Best fit**: Kato’s no-network mode and near-term agent model.

```mermaid
flowchart TB
  UI[CLI/GUI shell] --> ORCH[Orchestrator + Policy]
  ORCH --> STORE[Local-first store (workspace root)]
  ORCH -->|spawn worker per chat| W1[Agent Worker A\n(perms: read chat A, write out A)]
  ORCH -->|spawn worker per chat| W2[Agent Worker B\n(perms: read chat B, write out B)]
  W1 --> STORE
  W2 --> STORE
```

### Option B: Multi‑process per agent with OS‑enforced isolation

Spawn one process per agent. Enforce isolation using OS sandboxing (Linux namespaces via bubblewrap/Firejail, systemd service hardening, containers). Deno permissions still help but are not the “hard wall.”

**Pros**

- Potentially stronger boundary: OS can isolate mount namespaces, network namespaces, and syscalls. citeturn8search5turn8search0turn8search7turn22view0  
- Easier to add resource limits per agent (CPU/memory/time) at the OS/service layer. systemd provides unit sandboxing options and can restrict filesystem write paths. citeturn22view0turn21search4  

**Cons / threat-model implications**

- Cross-platform becomes messy: Windows/macOS sandboxes are different and your “default” would be inconsistent. citeturn22view0  
- In Deno specifically, subprocess execution is high risk: `--allow-run` enables spawning code outside the Deno sandbox and is explicitly called out as dangerous. If you use this, you must strictly constrain what can be executed. citeturn14view0turn16view1  

```mermaid
flowchart TB
  ORCH[Controller process] --> STORE[(Workspace root)]
  ORCH -->|spawn OS-sandboxed process| P1[Agent Process A\n(bwrap/firejail/systemd)]
  ORCH -->|spawn OS-sandboxed process| P2[Agent Process B\n(bwrap/firejail/systemd)]
  P1 --> STORE
  P2 --> STORE
```

### Option C: MicroVM or WASM sandbox for Stagecraft

For “run arbitrary code,” assume adversarial behavior and treat the execution runtime as **untrusted**.

**MicroVM approach**

- Deno Sandbox provides Linux microVMs on Deno Deploy, designed for running untrusted code, with per-sandbox network policies and ephemeral lifetimes. citeturn7search1turn7search2  
- This is cloud-based, which may or may not fit “local-first Stagecraft” unless you intentionally design a hybrid mode. citeturn7search1  

**WASM approach**

- Running Stagecraft logic as WASM can reduce the ambient power of scripts if you tightly control imports, but it is not automatically a secure sandbox unless you also constrain host calls (and you still need file/network boundaries outside WASM). Deno supports WebAssembly, but Stagecraft-grade isolation tends to require a dedicated sandbox design. citeturn4search16turn14view1turn25view0  

```mermaid
flowchart TB
  KATO[Kato host app] --> POLICY[Policy + Allowlisting]
  POLICY -->|untrusted code| SANDBOX[Isolation boundary\n(microVM or OS sandbox)]
  SANDBOX -->|results only| KATO
  SANDBOX -. optional .-> NET[(Limited egress allowlist)]
```

### Recommended default

Default to **Option A (single process + worker permissions)** now, with an explicit “escape hatch” roadmap to Option B and Option C.

This is not because Option A is the “most secure possible,” but because it is the only option that:

- maps directly to “agent-per-chat” without making `--allow-run` a foundational requirement, citeturn12search7turn14view0  
- is cross-platform enough for your unknown OS targets, citeturn12search7  
- allows you to build measurable tests and incrementally harden toward Stagecraft-grade isolation. citeturn11search0turn14view1turn25view0  

## Permission matrices and hardening recipes

This section is where your “own your AI conversations” claim becomes real: permissions become product surface area.

### Permission matrix for Kato modes

Assume a **workspace root** (e.g., `~/.kato/`) that contains all state: conversations, indices, exports, temp results. This is crucial because fixed permission scopes are much easier when all data resides under one root directory. citeturn5view0turn14view0

| Mode                           | Read                         | Write                    | Net                       | Run  | Env               | FFI  | Notes                                                                                                                |
| ------------------------------ | ---------------------------- | ------------------------ | ------------------------- | ---- | ----------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| Default interactive CLI        | `workspace/`                 | `workspace/`             | none                      | none | minimal           | none | Deno default is no disk/net/run; explicitly grant only workspace paths. citeturn5view0turn14view0                |
| Export (single-run)            | `workspace/`                 | none (stdout)            | none                      | none | none              | none | Prefer stdout export to avoid `--allow-write` for arbitrary destinations. citeturn5view0turn14view0              |
| Import (single-run)            | `workspace/` + import source | `workspace/`             | none                      | none | none              | none | Prefer stdin import so you don’t need read permission outside workspace. citeturn5view0turn14view0               |
| Agent worker (per chat)        | `workspace/chats/<id>`       | `workspace/out/<job>`    | none (initial)            | none | none              | none | WorkerOptions supports per-worker permission configuration; cannot exceed parent. citeturn12search7turn12search0 |
| Future networked agent         | chat file + prompt templates | outputs                  | allowlist (LLM API host)  | none | minimal allowlist | none | Prefer allowlisted net + audit logs + frozen lockfile. citeturn14view0turn4search1turn13view2                   |
| Stagecraft untrusted execution | *none (host controlled)*     | *none (host controlled)* | ideally none or allowlist | none | none              | none | Should run in sandbox/VM; Deno recommends OS sandbox / VM for untrusted code. citeturn14view1turn7search1        |

### Concrete Deno flags and compile-time options for common modes

#### Development run commands (strict offline posture)

Key flags and behaviors:

- `--no-remote`: do not resolve remote modules. citeturn5view0turn19view2  
- `--cached-only`: require deps already cached. citeturn5view0turn19view0  
- `--frozen` + `deno.lock`: fail if lockfile changes or is out of date. citeturn5view0turn13view2  
- `--no-prompt`: disable permission prompts (useful for CI and for “deterministic failure” behavior). citeturn12search3  

Example (dev, no network, workspace-scoped):

```bash
deno run \
  --no-remote --cached-only --frozen --lock=deno.lock \
  --no-prompt \
  --allow-read=~/.kato --allow-write=~/.kato \
  src/main.ts
```

The reason to bias toward a workspace root (`~/.kato`) is that permission scopes become stable across OSes without needing to grant broad read/write to user profile paths. citeturn14view0turn5view0turn23search3

#### Deno worker permissions for per-agent isolation

Deno supports specifying `deno.permissions` for workers, including `"none"` and explicit lists for `read`/`write`/`net` etc. citeturn12search7turn12search1

Sketch (not a full implementation):

```ts
const worker = new Worker(new URL("./agent_worker.ts", import.meta.url), {
  type: "module",
  deno: {
    permissions: {
      read: [chatPath],
      write: [outputPath],
      net: false,
      env: false,
      run: false,
      ffi: false,
      sys: false,
    },
  },
});
```

This puts the “agent-per-chat” promise into a construct you can test and fuzz. citeturn12search7turn11search0

#### Compile targets and deterministic builds

`deno compile` bundles a slimmed-down runtime with your module graph and applies runtime-affecting flags to the resulting binary. It supports `--target`, and also supports offline/dependency integrity options. citeturn3search30turn19view4

Example compile (no remote resolution, frozen lockfile):

```bash
deno compile \
  --target x86_64-unknown-linux-gnu \
  --output dist/kato \
  --no-remote --cached-only --frozen --lock=deno.lock \
  --allow-read=~/.kato --allow-write=~/.kato \
  src/main.ts
```

Deno’s compile story explicitly includes code signing considerations (embedding via an executable section using tooling aimed at producing signable binaries). citeturn23search3turn23search9

### Equivalent mitigation strategies for Node and Bun

If you choose Node or Bun, you should assume runtime permissions are weaker or nonexistent and instead lean on OS sandboxing. Even if you still use Node’s permission model, treat it cautiously because of documented bypass CVEs and explicit limitations. citeturn1view2turn10view0turn10view1

#### Linux: Firejail examples

Firejail’s `--net=none` disables network access by creating a new network namespace without devices (documented behavior and widely used). citeturn8search8turn8search32

Example pattern (run a Node/Bun agent script with no net and a private home):

```bash
firejail --net=none --private=/tmp/kato-agent-home \
  node --permission --allow-fs-read=~/.kato/chats/A --allow-fs-write=~/.kato/out/A agent.js
```

This is not a full solution (filesystem mapping and leakage still need care), but it’s a concrete baseline. citeturn8search8turn1view2

#### Linux: bubblewrap examples

bubblewrap is a low-level unprivileged sandboxing tool (mount namespaces, user namespaces, etc.) and is explicitly described as a construction kit rather than a complete policy. citeturn8search5turn8search9

Example pattern (bind only the needed paths):

```bash
bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind "$PWD/.kato/chats/A.jsonl" "/work/chat.jsonl" \
  --bind "$PWD/.kato/out/A.txt" "/work/out.txt" \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc \
  /usr/bin/node agent.js
```

This is intentionally “paranoid” and OS-specific; it is powerful, but it increases your support surface. citeturn8search5turn8search9

#### Linux daemon mode: systemd unit hardening

systemd provides built-in sandboxing directives, and man pages document how things like `NoNewPrivileges=` and filesystem protections work and how allowlisting writable paths is expected (e.g., with `ReadWritePaths=`). citeturn22view0turn22view1

A pragmatic daemon hardening profile (illustrative; you must tune):

```ini
[Service]
ExecStart=/usr/local/bin/kato-daemon
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/kato
PrivateNetwork=yes
```

The key idea is: the daemon can only write where you explicitly allow it, and cannot escalate privileges. citeturn22view0turn21search10turn21search4

### Security hardening steps that operationalize least privilege

These are non-optional if you want defensible “own your conversations” messaging.

- **Deny-by-default and explicit allowlists**: Deno supports allow and deny flags (`--deny-*`) and warns about privilege escalation-like effects for certain permissions. citeturn4search8turn16view1turn14view0  
- **Block privileged OS paths when broad read/write is granted**: historical advisories show why `/proc`, `/sys`, `/dev`, `/etc` can become permission escalators (e.g., reading `/proc/self/environ` as an env-variable equivalent). Deno fixed/mitigated classes of this by requiring explicit `--allow-all` for some paths in newer versions and recommends deny flags as workarounds in older versions. citeturn16view1turn16view3turn25view2  
- **Freeze dependency graph**: enforce `--frozen` lockfile checks and use `--cached-only` / `--no-remote` to prevent unexpected new code from being loaded. citeturn13view2turn5view0turn14view1  
- **Use permission auditing as a test artifact**: Deno supports JSONL audit logs of permission checks via `DENO_AUDIT_PERMISSIONS`. Make this part of CI and integration tests. citeturn4search1turn4search3  
- **Disable implicit online behaviors where possible**: Deno notes it may contact an update endpoint (configurable via environment variable). For “no-network initial mode,” you should ensure your product does not unexpectedly attempt outbound traffic even for update checks. citeturn14view0  

## Migration roadmap and deliverables

The roadmap below is intentionally structured as “security deliverables + product deliverables.” If you only rebuild features, you will not end up with a stronger security story.

| Milestone                               | Deliverables (concrete)                                                                                                                                                                                                     | Effort      | Key tests                                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition and threat model             | Written spec for local-first store, import/export format, agent-per-chat rules; explicit threat model (prompt injection, supply-chain, malicious plugins, local attacker); permission matrix adopted as a baseline artifact | Medium      | Threat-model validation checklist; “permission budget” review per command                                                                                              |
| Deno-native repo scaffold               | `deno.json` tasks, lockfile policy, CI pipeline with fmt/lint/test/coverage; baseline CLI skeleton; workspace root initialization; minimal storage (create/read chat)                                                       | Low–Medium  | CLI integration tests in `deno test`; “no network” checks using `--no-remote` and audit logs citeturn18search0turn11search0turn4search1                           |
| Local-first data model + import/export  | Conversation store schema (JSONL or SQLite); deterministic export (stdout) and import (stdin) format; migration adapter from existing Kato data                                                                             | Medium      | Fuzz import parsing; golden-file export tests; idempotency tests                                                                                                       |
| Agent-per-chat worker isolation         | Worker launcher; strict `deno.permissions` per worker; agent protocol (stdin/stdout messages); job runner with timeouts                                                                                                     | Medium–High | Permission-bypass tests: attempt cross-chat reads/writes; symlink/path escape tests; worker permission regression suite citeturn12search7turn11search0turn25view2 |
| Packaging + distribution                | `deno compile` builds for major targets; reproducible build steps with `--frozen`/`--cached-only`; release artifacts; (optional) signing/notarization playbook                                                              | Medium      | Smoke tests per OS target; binary permission behavior tests; “offline run” tests citeturn3search30turn19view4turn10view2turn23search3                            |
| Optional daemon and GUI wrapper         | Daemon mode running local scheduling; systemd/launchd/Windows service *optional*; GUI wrapper calls CLI or embeds local UI                                                                                                  | Medium–High | Daemon hardening tests (filesystem allowlist); lifecycle tests; upgrade tests citeturn22view0turn21search4                                                         |
| Stagecraft execution substrate (future) | Prototype of untrusted code execution: (a) OS sandbox wrapper mode on Linux, and/or (b) microVM execution strategy (e.g., Deno Sandbox cloud microVM) with egress allowlists                                                | High        | Red-team scripts; resource exhaustion tests; “escape attempt” harness; network exfil tests citeturn14view1turn7search1turn8search7                                |

### CI/CD recommendations (aligned to Deno ergonomics)

Deno’s own CI docs explicitly frame a baseline pipeline around `deno test`, `deno lint`, `deno fmt`, and `deno coverage`, and points to an official starter workflow. citeturn18search0turn11search1turn11search0

Minimum CI gates for Milestone 2+:

- `deno fmt --check` and `deno lint` on every PR. citeturn11search1  
- `deno test` with a mix of unit tests and integration tests; use per-test permissions to ensure tests do not accidentally use broad permissions. citeturn11search0turn11search7  
- A “permission audit” integration test job: run representative commands with `DENO_AUDIT_PERMISSIONS` and assert the audit log does not contain unexpected permission requests. citeturn4search1turn4search3  
- A “dependency integrity” job: run with `--frozen` (and optionally `--no-remote`) and fail if new deps appear. citeturn13view2turn5view0  

## Tradeoff tables

### Runtime comparison for Kato’s requirements

| Criterion                           | Deno                                                                                                                                                  | Node                                                                                                                            | Bun                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Default sandbox posture             | Deny-by-default disk/net/run; explicit permission flags. citeturn5view0turn14view0                                                                | Historically full access; permission model exists but documented as limited against malicious code. citeturn1view2           | No Deno-style permission sandbox today; community requests for it remain open. citeturn17view2turn17view3                   |
| Agent-per-chat isolation primitives | Worker-level permission config supports per-agent sandboxing. citeturn12search7turn12search0                                                      | Permission model exists but has had multiple bypass CVEs; treat as fragile for isolation claims. citeturn10view0turn10view1 | Must rely on OS sandboxing to isolate untrusted execution. citeturn17view2                                                   |
| Single-binary distribution          | `deno compile`, flags preserved into binary. citeturn3search30turn23search3                                                                       | SEA via `node --build-sea`, includes signing guidance. citeturn10view2                                                       | `bun build --compile` produces executable containing Bun binary; code signing guidance exists. citeturn17view1turn23search2 |
| Supply-chain controls               | Lockfile + `--frozen`/`--no-remote`/`--cached-only`; import allowlists; permission audit logs. citeturn13view2turn5view0turn14view0turn4search1 | Mature npm ecosystem; permission model security has had repeated issues. citeturn10view0turn10view1                         | Security scanner API and minimum release age controls at install time. citeturn17view4                                       |
| Long-term maintenance risk          | Rapid releases; LTS ending April 30, 2026 implies upgrade discipline required. citeturn18search2                                                   | Stable enterprise usage; permission model maturity still evolving. citeturn1view2turn10view0                                | Fast-moving; fewer sandbox primitives; depends on OS sandboxing. citeturn17view2turn17view3                                 |

### Isolation strategy comparison (independent of runtime)

| Strategy                           | Security                                                                                                                      | Performance | Developer productivity | Distribution complexity |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------- | ----------------------- |
| In-process guardrails only         | Weak for adversarial code; one exploit compromises all. citeturn25view0                                                    | Best        | Best                   | Lowest                  |
| Worker-level permission scoping    | Good for least privilege among components; still runtime-enforced not kernel-enforced. citeturn12search7turn16view1       | Good        | Good                   | Low                     |
| Subprocess per agent + OS sandbox  | Stronger boundary on Linux; cross-platform support burden high. citeturn8search5turn8search0turn22view0                  | Medium      | Medium                 | High                    |
| MicroVM execution                  | Strong isolation designed for untrusted code; often adds latency/cost and can be cloud-tied. citeturn7search1turn7search2 | Medium–Low  | Medium                 | High                    |
| Permission broker (policy service) | Centralized decisions; can enforce consistent policy; adds new attack surface (broker) and complexity. citeturn14view0     | Medium      | Medium                 | Medium                  |

## Example prompts/snippets for Claude Code or Codex

These are structured to help a coding assistant deliver Milestone 1 quickly while keeping the security posture coherent.

### Prompt for Milestone 1 scaffold

> Create a Deno 2 project scaffold for a CLI called `kato`. Requirements:
> - Use `deno.json` with tasks: `fmt`, `lint`, `test`, `dev`, `build:linux`, `build:mac`, `build:win`.
> - Use a workspace root directory `~/.kato/` (create on `kato init`).
> - Implement commands: `kato init`, `kato chat new`, `kato chat list`, `kato export` (to stdout), `kato import` (from stdin).
> - Initial mode must not require network access; include `--no-remote`, `--cached-only`, `--frozen`, and lockfile usage in dev tasks.
> - Include unit tests for init and export/import round-trip.
> - Use standard library CLI parsing.
> - Provide the full repo tree and code.

Relevant Deno CLI behaviors for “sandbox by default” and permission flags should be assumed. citeturn5view0turn7search15turn13view1turn13view2

### Sample `deno.json` (starter)

```jsonc
{
  "name": "kato",
  "version": "0.1.0",
  "imports": {
    "@std/cli": "jsr:@std/cli@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/assert": "jsr:@std/assert@^1.0.0"
  },
  "lock": { "frozen": true },
  "tasks": {
    "fmt": "deno fmt",
    "fmt:check": "deno fmt --check",
    "lint": "deno lint",
    "test": "deno test",
    "dev": "deno run --no-remote --cached-only --frozen --lock=deno.lock --allow-read=~/.kato --allow-write=~/.kato src/main.ts",
    "build:linux": "deno compile --no-remote --cached-only --frozen --lock=deno.lock --allow-read=~/.kato --allow-write=~/.kato --target x86_64-unknown-linux-gnu --output dist/kato src/main.ts",
    "build:mac": "deno compile --no-remote --cached-only --frozen --lock=deno.lock --allow-read=~/.kato --allow-write=~/.kato --target aarch64-apple-darwin --output dist/kato-mac src/main.ts",
    "build:win": "deno compile --no-remote --cached-only --frozen --lock=deno.lock --allow-read=~/.kato --allow-write=~/.kato --target x86_64-pc-windows-msvc --output dist/kato.exe src/main.ts"
  }
}
```

This intentionally keeps permissions scoped to `~/.kato` and uses frozen lockfile behavior. citeturn13view2turn5view0turn19view4

### Prompt for Milestone 2 agent worker launcher

> Implement an agent-per-chat worker model:
> - Main process reads conversation state at `~/.kato/chats/<chatId>.jsonl`.
> - For each agent run, create a worker with permissions:
>   - read: only that chat file
>   - write: only `~/.kato/out/<chatId>/<runId>.txt`
>   - net/env/run/ffi/sys: disabled
> - Worker receives `{ chatPath, outputPath, instructions }` and writes output file.
> - Add a test that attempts to read another chat file from inside the worker and verifies it fails (permission denied).
> - Add integration test that two workers cannot clobber each other’s output paths.
> Provide implementation and tests.

This directly leverages documented worker permissions behavior. citeturn12search7turn12search0turn11search0

### Prompt for build, security tests, and CI

> Add security regression tests and CI:
> - Add a test harness that runs representative CLI commands with `DENO_AUDIT_PERMISSIONS` enabled and asserts only expected permissions are used.
> - Add tests for symlink/path escape attempts within `~/.kato` (create symlink that points outside and verify reads/writes are denied).
> - Create a GitHub Actions workflow (or equivalent) running: fmt:check, lint, test, and coverage.
> - Document how to run in “no prompt” mode for CI and how to run interactively (prompt allowed) for local dev.
> Provide workflow YAML and the audit log parser.

Deno documents permission audit logs, prompts behavior, and CI structure. citeturn4search1turn12search3turn18search0