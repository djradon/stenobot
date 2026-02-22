---
id: ik6gyst9ci94xp6evsvr6oi
title: 2026 02 21 Deno Rewrite Metaplan
desc: ''
updated: 1771722315982
created: 1771717313979
---

## djradon's plan

- create a new blank repo, run deno init and establish bootstrap quality gates (fmt/lint/test/CI) 
- configure a Dendron self-contained vault for "dev-notes": contains tasks, conversations, and developer guidance
- embed the old "stenobot" workingtree (.gitignored) for reference
- develop starter dev documentation:
  - dev.general-guidance
  - dev.security-baseline
  - dev.feature-ideas
  - dev.daemon-implementation
- create CLAUDE.md, GEMINI.md, and CODEX.md files that reference dev.general-guidance
- have some or all of the 3 LLM agents (Claude, Codex, Gemini) collaborate with me on planning and sequencing an "MVP epic", focusing first on library selection/replacement:
  - CLI framework
  - OpenTelemetry https://docs.deno.com/runtime/fundamentals/open_telemetry/
    - Sentry integration ? It looks like it supports logs and tracing as well as error monitoring now
  - OpenFeature: only because I recently read that feature flags are important for security, not sure if deno support is good but there is ( @grunet/openfeature-for-denodeploy) -- 
- port existing parser test fixtures to deno test
