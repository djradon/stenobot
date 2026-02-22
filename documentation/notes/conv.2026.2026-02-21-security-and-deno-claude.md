---
id: d2ihng7ly8g9t5z88o74r4v
title: 2026 02 21 Security and Deno Claude
desc: ''
updated: 1771720825552
created: 1771720801180
---

# User_2026-02-21_1506_38

I'm considering a ground-up rewrite of Stenobot (henceforth to be known as Kato) in Deno. After chatting about it for a while with ChatGPT, I asked ChatGPT to generate a "deep-research" prompt for hatching a plan to harness the learnings from the Stenobot "proof-of-concept" and put us on a better security footing, given that I want Kato to be acceptable for corporate use.

ChatGPT's report is in research.2026-02-21-deno-security.md . It is riddled with errors and poor judgement, but in its defense, it didn't have access to the Stenobot code, documentation, and conversation history.

Please rewrite ChatGPT's report into research.2026-02-21-deno-security.claude.md, letting me know if you have any questions. The mentions of stagecraft can be removed entirely.

# claude-sonnet-4.6_2026-02-21_1506_41

Let me start by reading the relevant files to understand the context.

Now let me read the Stenobot codebase and documentation to understand the actual project.

Let me also look at the source code structure and the other research files.

Let me also check the package.json and the other research files for context.

Now I have a solid understanding of Stenobot's actual codebase. Let me write the rewritten report, grounded in what Stenobot actually is and does.

The rewrite is done. Here's a summary of the major changes from the ChatGPT report:

**Removed:**
- All Stagecraft content (running arbitrary code, microVM execution, WASM sandboxes, "untrusted code execution" architecture) — gone entirely
- Fabricated CVE numbers
- The stdout/stdin export recommendation (doesn't match Kato's incremental recording model)
- The "export/import via stdin/stdout to minimize permissions" framing — not how Kato works

**Corrected:**
- **Threat model**: The real risks are output path injection via in-chat command parsing, broad-but-explicit filesystem read, and supply-chain exposure — not AI agent sandboxing
- **Worker framing**: Workers are *per-provider session monitors*, not per-AI-agent sandboxes
- **Permission tension surfaced**: `deno compile` bakes permissions in at build time, which breaks non-default session directory configurations — the original report ignored this entirely
- **The `--deny-net --deny-run --deny-ffi` pattern**: explicit denials, not just absence of `--allow-*`, to make the no-network invariant enforceable in the binary

**Added from actual Stenobot codebase:**
- Specific learnings: what worked (daemon/CLI split, provider abstraction, write-stabilization semantics, session deduplication) and what needs improvement (no output allowlist, no lockfile integrity, no permission scope)
- The `allowlistedOutputPaths` design as the specific mitigation for in-chat command injection
- Atomic state writes and schema validation as concrete improvements
- Notes on replacing chokidar with `Deno.watchFs()` while preserving the stabilization logic

# User_2026-02-21_1523_44

compare @documentation/notes/research.2026-02-21-deno-security.claude.md @documentation/notes/research.2026-02-21-deno-security.codex.md and
   @documentation/notes/research.2026-02-21-deno-security.gemini.md and evaluate which is the best rewrite

# claude-sonnet-4.6_2026-02-21_1524_23

Here's my honest comparative evaluation — I'll try not to be self-serving about my own version.

---

## Comparison Summary

### Codex's rewrite — strongest on codebase grounding

Codex had direct access to the source and it shows. Key strengths:

- **Most accurate about what already exists** in Stenobot. It correctly identifies atomic state writes, byte-offset incremental parsing, and immediate user-message emission in the Codex parser as things *to preserve*, not add. My rewrite framed atomic state writes as new work needed, which is wrong if Stenobot already does this.
- **Specific file and function references** throughout (`src/core/monitor.ts resolveOutputPath`, `src/providers/codex/parser.ts`, etc.), making it directly usable by an engineer picking up the codebase.
- **Introduces concepts the others miss**: separate audit log stream vs. operational logs; parser anomaly telemetry (invalid line rate, malformed payloads); strict command grammar as a corporate-default vs. compatibility flag.
- **Open questions section** is the most valuable feature. These are genuine decisions that need answers before coding begins, and neither Gemini nor I surfaced them.
- **Suggested immediate next step** is concrete and actionable.

Weaknesses: no code sketches, no `deno.json` sample, doesn't address the compile-time permission tension.

---

### Gemini's rewrite — strongest executive framing

- Cleanest and most readable. Best for a non-technical stakeholder or security auditor.
- Good threat model table, clear phase structure.
- The `kato --permissions` CLI idea is a nice UX touch nobody else raised.
- Weakest on depth: doesn't address compile-time permission tension, less grounded in Stenobot specifics, phases lack exit criteria.

---

### My (Claude's) rewrite — strongest on novel architectural analysis

- **Compile-time permission tension** (baked binary permissions vs. user-configured paths) is a real design constraint that neither Codex nor Gemini surface. This needs to be resolved before the architecture is finalized.
- Best code examples: `deno.json` tasks, worker permission sketch, systemd unit, development run command.
- Explicit `--deny-net` vs. just-not-implementing-networking distinction is important.
- The "Notes on ChatGPT Source Analysis" section is useful as a diff record.

Weaknesses: too long; framed some already-existing Stenobot behaviors as new work; no open questions raised; less specific about file-level code surfaces than Codex.

---

## Verdict

**Codex** is the most useful for starting the rewrite — it's the most accurate about the current codebase and raises the right pre-coding questions. **Mine** adds architectural value (compile-time permission tension, detailed code sketches) that Codex lacks. **Gemini** is the best for a pitch or executive summary.

The ideal document would synthesize all three: Codex's gap analysis and open questions as the backbone, my architectural details and code sketches as the implementation reference, and Gemini's executive framing up front. Would you like me to produce that synthesis?

# User_2026-02-21_1617_17

Do you think I should do a ground-up rewrite in deno?

# claude-sonnet-4.6_2026-02-21_1617_53

Honest answer: the case for Deno is real but not urgent, and the most critical security gap doesn't require it.

## What the rewrite actually buys you

**Genuinely valuable:**
- Binary-embedded permissions (`--deny-net` baked in) is a real corporate differentiator — a security auditor can verify the binary's scope without reading source
- Single-binary distribution removes the Node.js runtime requirement
- Supply-chain reduction (replacing chokidar, winston, yaml, nanoid with stdlib) is meaningful
- Clean break fits the rename to Kato anyway

**Less valuable than it sounds:**
- Worker-per-provider isolation is defense-in-depth, not a hard boundary — parent process holds union of all permissions anyway
- The compile-time permission tension I raised is a genuine friction: if users have non-default session paths, the baked permissions break. You'll likely end up with `--allow-write=$HOME` anyway.

## What doesn't require a rewrite

The single most important security gap — **output path injection via in-chat commands** — is a ~30-line fix to `resolveOutputPath` in [src/core/monitor.ts](src/core/monitor.ts). Add an allowlist check after path resolution. That's it. Node or Deno.

State schema validation, atomic writes, and no-network enforcement are similarly achievable in the existing codebase.

## My actual take

**Don't do a ground-up rewrite yet if** you want to ship Kato usefully soon. Fix the path allowlist in Stenobot today. That addresses the real vulnerability.

**Do the rewrite if** corporate distribution is genuinely on the near horizon and you need the binary permission story. In that case, follow the Codex Phase 0 roadmap: write the threat model, path policy, and permission matrix *before* writing code. The rewrite is only worth it if it's done with that discipline.

The middle path: patch the critical gap now, plan the rewrite carefully, don't conflate "we're using Deno" with "we have a security story."

# User_2026-02-21_1643_42

Regarding the "less valuable than it sounds", could the daemon launcher read the allowed input and output locations from the config file, and then launch-fork the parent process with a well-constrained list of file access permissions? Is that actually helpful, security-wise? The current "self-daemonize" approach already does that.

The reason I've been leaning towards the rewrite now is:
- switching to Deno will be a big undertaking, better to adjust now while the footprint is smaller
- there might be some learnings from the initial MVP that we can integrate into an improved, stronger base for future development.

::capture @documentation/notes/conv.2026.2026-02-21-security-and-deno-claude.md

# claude-sonnet-4.6_2026-02-21_1644_28

On the launcher-with-constraints idea: yes, it's technically straightforward — the `start` command already spawns the daemon as a detached process, so passing Node's `--experimental-permission --allow-fs-read=<paths> --allow-fs-write=<paths>` flags to that spawn call is a direct addition. And it does help: if `resolveOutputPath` returns a bad path, `fs.writeFile` fails at the Node permission level, not just at application logic.

But the security value is genuinely limited in Node's case:

- Node's own docs state the permission model "is not a security boundary against malicious code" — it's had bypass vulnerabilities precisely in filesystem and symlink handling
- The constraints live in the launcher script, not the binary. A user (or attacker) can bypass them by running the daemon directly without the flags
- The config file is still a trust boundary — expanding the allowlist in config expands the daemon's permissions

So in Node: the pattern is real, partially useful, but you're relying on something the runtime vendor explicitly doesn't guarantee.

In Deno: same pattern, but `deno compile` bakes the outer permission boundary into the binary. A user can't accidentally (or deliberately) run the daemon without those constraints. That's the meaningful difference — not that Deno's runtime sandbox is perfect, but that the boundary is **artifact-level, not invocation-level**.

---

On the rewrite timing: your reasoning is sound. The two arguments you gave are the real ones:

1. **Smaller footprint now** — the parser logic, daemon lifecycle, provider abstraction, and file-watching code are all still small enough to carry across clearly. Wait another year and there will be more providers, more edge cases in the parsers, more state machinery.

2. **Integrating MVP learnings** — there are real things to do differently: the path allowlist, the write-scoped worker model (Codex's destination-scoped writer worker idea is genuinely better than the current single-process write), the strict command grammar. A rewrite is the right time to make these structural, not bolt them on.

The counter-argument I raised ("most security improvements don't require a rewrite") is true but less important than the engineering foundation argument. If the rewrite is happening anyway, sooner is better.