---
id: se9k1msrgjdvxyzz59rz2m2
title: Daemon Implementation
desc: ''
updated: 1771545427808
created: 1771545427808
---

## Overview

The daemon is a detached background process that:

1. Discovers active LLM session files (Claude Code + Codex)
2. Watches them for changes
3. Parses only new content from byte offsets
4. Handles in-chat commands (`::record`, `::capture`, `::export`, `::stop`)
5. Persists progress in `~/.stenobot/state.json`

Core files:

- `src/cli/commands/start.impl.ts`
- `src/cli/commands/stop.impl.ts`
- `src/cli/commands/restart.impl.ts`
- `src/core/monitor.ts`
- `src/core/state.ts`

## Process Model

`start` has two paths:

- Parent CLI path:
  - Ensures config exists
  - Prepares PID/log directories
  - Spawns a detached child with `STENOBOT_DAEMON_MODE=1`
  - Redirects child stdout/stderr to `daemon.log`
  - Writes daemon PID to `daemon.pid`
- Worker path (`runDaemon`):
  - Configures file logging (no console transport)
  - Acquires daemon lock (`daemon.pid.lock`)
  - Starts `SessionMonitor`
  - Installs signal/error handlers
  - On shutdown: stops monitor, removes PID + lock files

## PID And Lock Semantics

Two files are used:

- `daemon.pid`: convenience pointer for CLI/status
- `daemon.pid.lock`: authoritative single-instance lock

Rules:

1. Lock is source of truth for "daemon is running".
2. `start` heals stale PID files when lock points to a live daemon.
3. `start` clears stale lock/PID files when lock PID is dead.
4. `stop` sends `SIGTERM`, waits for exit (5s max), then removes PID file.
5. `restart` checks lock-backed liveness; if running, stop+wait, then always start.

This avoids dual daemons and stale PID false-positives.

## SessionMonitor Architecture

`SessionMonitor` (`src/core/monitor.ts`) owns runtime work:

1. `start()`:
  - Loads state
  - Discovers sessions from enabled providers
  - Creates file watchers (`chokidar`)
  - Starts periodic rediscovery + periodic state saves
2. `watchSession()`:
  - Adds file change watcher
  - Immediately triggers catch-up processing
3. `processSession()`:
  - Single-flight guard per session (`processingSession` set)
  - Parses from `lastProcessedOffset`
  - Updates state offset/timestamp
  - Applies command handling and incremental export rules

## Command Flow

Commands are detected only in user messages:

- `::capture path`: full export (`mode: overwrite`) + begin recording to that file
- `::record path`: begin forward-only recording (no backfill export)
- `::export path`: one-off full export, does not start recording
- `::stop`: stop active recording for that session

Incremental export appends only newly parsed messages after the stored offset.

## State Model

`state.json` stores:

- `sessions[sessionId]`: provider, file path, last processed offset/timestamp
- `recordings[sessionId]`: output file, started timestamp, last exported timestamp

Writes are atomic (`state.json.tmp` + rename) and are throttled by dirty tracking.

## Debugging

Useful defaults:

- PID: `~/.stenobot/daemon.pid`
- Lock: `~/.stenobot/daemon.pid.lock`
- Log: `~/.stenobot/daemon.log`

Enable detailed recording diagnostics:

```bash
STENOBOT_RECORDING_DEBUG=1 pnpm dev start
```

Quick triage:

1. `stenobot status`
2. check lock/PID consistency
3. inspect `daemon.log` for `Capturing session`, `Starting recording`, `Stopping session monitor`
