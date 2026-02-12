---
id: b10bo18sfpettzqb535rkkh
title: Implementation Plan
desc: ''
updated: 1770849234734
created: 1770799535662
---

## Overview

A TypeScript-based tool that monitors Claude Code CLI conversation logs in real-time and automatically exports them to markdown files when requested. The name "clogger" stands for "chat logger" - designed to eventually support multiple LLM platforms beyond Claude.

## Core Requirements

### Functional Requirements
1. **Real-time monitoring** of Claude Code session JSONL files
2. **Command detection** - recognize "please record this session to `<filename>`" in conversation
3. **Resume capability** - track processing state and resume after interruptions
4. **Cross-platform** - work on Windows and WSL2
5. **Markdown export** with detailed metadata (timestamps, tool calls, thinking blocks)
6. **Dendron compatibility** - generate proper YAML frontmatter

### Technical Requirements
- **Language**: TypeScript (Node.js)
- **Node version**: Node 20+ (LTS, EOL April 2026)
- **Cross-platform**: Use path normalization and platform-agnostic file APIs
- **Resilience**: State persistence for crash recovery
- **Modularity**: Provider-based architecture for multi-LLM support

## Architecture

### Control Planes

**Two distinct command interfaces** (never conflate these):

1. **CLI Commands** (`clogger start/stop/status/export`)
   - Daemon lifecycle control
   - Manual export triggers
   - Configuration management
   - Executed via terminal/shell

2. **In-Chat Commands** (`::record/::stop/::pause`)
   - Recording control within conversations
   - Detected by parsing conversation logs
   - Executed by the monitoring daemon
   - No direct shell interaction

### Components

#### 0. Provider Interface
**Purpose**: Abstract LLM-specific session discovery and parsing

**Responsibilities**:
- Define common interface for all LLM platforms
- Session discovery (find active conversation files)
- Message parsing (extract messages, timestamps, metadata)
- Platform-specific quirks handling

**Implementation Notes**:
- Base interface in `src/providers/base.ts`
- Initial provider: Claude Code (`src/providers/claude-code/`)
- Future providers: ChatGPT, Cursor, Continue, etc.
- Each provider implements:
  ```typescript
  interface Provider {
    name: string;
    discoverSessions(): AsyncIterable<Session>;
    parseMessages(sessionFile: string): AsyncIterable<Message>;
    resolveWorkspaceRoot?(sessionFile: string): string;
  }
  ```

#### 1. Session Monitor
**Purpose**: Watch for active LLM sessions and monitor their conversation files

**Responsibilities**:
- Use configured Provider to discover sessions
- Detect active sessions (new files or modified recently)
- Watch session files for new entries using file system watchers
- Handle multiple concurrent sessions across multiple providers

**Implementation Notes**:
- Use `chokidar` for cross-platform file watching
- Delegate session discovery to Provider implementations
- Poll for new sessions periodically (every 5-10 seconds)
- Maintain map of active sessions with their last-read positions
- Support multiple active providers simultaneously

#### 2. Message Parser (Provider-specific)
**Purpose**: Parse and stream conversation data in provider-specific formats

**Responsibilities**:
- Read conversation files (JSONL, JSON, or other formats)
- Parse entries safely (handle malformed data)
- Extract relevant message data:
  - User messages
  - Assistant responses
  - Tool calls and results
  - Timestamps
  - Thinking blocks (if present)
- Track file position for resume capability
- Normalize messages into common format

**Implementation Notes**:
- Each provider implements its own parser
- Claude Code: JSONL streaming parser
- Store last-processed line number/position per session
- Handle truncated/incomplete entries gracefully
- Output normalized `Message` objects

#### 3. In-Chat Command Detector (Recording Control)
**Purpose**: Detect recording commands in conversation text (separate from CLI commands)

**Responsibilities**:
- Scan user messages for in-chat command syntax: `::command [args]`
- Parse and execute supported in-chat commands:
  - `::record <filename>` - Start/restart recording to filename (captures full session retroactively)
  - `::stop` - Stop current recording
  - `::pause` - Pause recording (optional)
  - `::resume` - Resume paused recording (optional)
  - `::status` - Show current recording status (optional)
  - `::summarize <filename>` - Generate AI summary and save (future enhancement)
- Handle path resolution:
  - Full paths (from @-mentions or explicit): use as-is
  - Relative paths: resolve against workspace root
  - Auto-add `.md` extension if missing

**Implementation Notes**:
- Simple regex: `^::(\w+)\s*(.*)$` for command parsing
- Commands are case-insensitive
- @-mentions in VSCode are already resolved to full paths in conversation logs
- Validate filename format (e.g., Dendron naming conventions)
- Commands only recognized in user messages (not assistant responses)
- Unrecognized commands are silently ignored (or logged as warnings)
- **These are NOT CLI commands** - they control recording behavior within conversations

#### 4. State Manager
**Purpose**: Persist processing state for crash recovery

**Responsibilities**:
- Track last-processed position for each session file
- Store active recording targets (session ID → output filename mappings)
- Persist state to disk periodically
- Load state on startup
- Clean up state for completed/old sessions

**Implementation Notes**:
- Store state in `~/.clogger/state.json`
- Include timestamps for cleanup logic
- Atomic writes to prevent corruption
- State schema:
  ```typescript
  {
    sessions: {
      [sessionId: string]: {
        filePath: string,
        lastProcessedLine: number,
        lastProcessedTimestamp: string,
        recordingTarget?: string,
        recordingStarted?: string
      }
    },
    recordings: {
      [sessionId: string]: {
        outputFile: string,
        started: string,
        lastExported: string
      }
    }
  }
  ```

#### 5. Markdown Exporter
**Purpose**: Convert conversation data to formatted markdown

**Responsibilities**:
- Generate Dendron YAML frontmatter
- Format each message with heading: `## Speaker_YYYY-MM-DD_HHMM_SS`
- Style user messages in italics for visual distinction
- Include timestamps (always on)
- Optional metadata (default OFF):
  - Tool calls with descriptions
  - Tool results (formatted/truncated)
  - Thinking blocks
- Handle special content types (code blocks, file paths)
- Incremental export (append new messages to existing file)
- Capture full session retroactively when recording starts

**Implementation Notes**:
- Use template system for flexibility
- Each message = one H2 heading (enables deep linking and VSCode outline navigation)
- Wrap user message content in `*italics*`
- Preserve markdown formatting from assistant responses
- Generate unique Dendron IDs (timestamp-based or UUIDs)
- Support both relative paths (from workspace root) and absolute paths from @-mentions

#### 6. CLI Interface (Daemon Control)
**Purpose**: Provide command-line control and status (separate from in-chat commands)

**Responsibilities**:
- Start/stop monitoring daemon
- List active sessions
- Manually trigger export for specific session
- View current state
- Configure settings

**CLI Commands** (via Stricli):
```bash
clogger start              # Start monitoring daemon
clogger stop               # Stop daemon
clogger status             # Show active sessions and recordings
clogger export <session>   # Manually export session
clogger export <session> --output <file>  # Export to specific file
clogger clean              # Clean up old state
clogger config             # Interactive configuration
```

**Implementation Notes**:
- Uses Stricli for type-safe command definitions
- Lazy-load command implementations (don't load chokidar/winston for `--help`)
- Each command is a separate module for code splitting
- Context object pattern for dependency injection
- Commands operate on daemon lifecycle, NOT recording state

**Configuration Options**:
- Output directory for recordings
- File naming template
- Metadata inclusion preferences
- Polling intervals
- State cleanup thresholds
- Active providers

### Output Format Example

```markdown
---
id: abc123xyz
title: Clogger Design Discussion
desc: 'Conversation about implementing conversation recording'
created: 1770794444646
updated: 1770795500000
---

## Dave_2026-02-10_2336_18

*I want a solution for recording my conversations with you into markdown files. Ideally, they get recorded verbatim "as we go", is it possible?*

## Claude_2026-02-10_2336_25

I can help you explore solutions for automatically recording conversations to markdown files. This is a question about Claude Code CLI capabilities, so let me investigate what options are available.

## Dave_2026-02-10_2340_12

*::record @private-notes/conv.clogger-design.md*

## Claude_2026-02-10_2340_15

I can help you explore solutions for automatically recording conversations to markdown files...

---

**Configuration options** (metadata.includeToolCalls = true):

## Claude_2026-02-10_2336_25

I can help you explore solutions...

<details>
<summary>Tool Calls</summary>

**Task** (claude-code-guide): Research conversation export options
- Explored Claude Code documentation for export features
- Result: No built-in "verbatim as you go" feature exists

</details>
```

### Data Flow

```
1. Session Monitor detects new JSONL entry
   ↓
2. JSONL Parser extracts message data
   ↓
3. Command Detector scans for recording trigger
   ↓
4. If trigger found → activate recording for this session
   ↓
5. Markdown Exporter writes full session (from start) to file
   ↓
6. State Manager persists recording state
   ↓
7. For subsequent messages: append incrementally to file
   ↓
8. State Manager updates last-processed position
```

## Technical Specifications

### Dependencies

**Core**:
- `@stricli/core` - TypeScript-first CLI framework with type-safe commands
- `chokidar` - File system watching (cross-platform)
- `chalk` - Terminal colors/formatting
- `yaml` - YAML frontmatter generation

**Utilities**:
- `date-fns` - Date formatting
- `nanoid` - ID generation
- `zod` - Runtime type validation
- `winston` - Logging
- `prompts` - Interactive CLI prompts (for `clogger config`)

**Development**:
- TypeScript 5.x
- Node.js 20+ LTS (for stable native fetch, performance, ESM support)
- `pnpm` - Package manager (faster, better disk usage than npm)
- `tsx` - TypeScript execution
- `vitest` - Testing

### Project Structure

```
clogger/
├── src/
│   ├── cli/
│   │   ├── commands/        # Stricli command implementations (start/stop/status/export/config/clean)
│   │   └── index.ts         # CLI entry point
│   ├── core/
│   │   ├── monitor.ts       # Session Monitor (multi-provider)
│   │   ├── detector.ts      # In-chat Command Detector
│   │   ├── state.ts         # State Manager
│   │   └── exporter.ts      # Markdown Exporter
│   ├── providers/
│   │   ├── base.ts          # Provider interface
│   │   ├── claude-code/
│   │   │   ├── index.ts     # Claude Code provider implementation
│   │   │   ├── parser.ts    # JSONL message parser
│   │   │   └── discovery.ts # Session discovery (~/.claude/projects/)
│   │   └── registry.ts      # Provider registry
│   ├── types/
│   │   └── index.ts         # Shared TypeScript interfaces
│   ├── utils/
│   │   ├── paths.ts         # Cross-platform path handling
│   │   └── logger.ts        # Logging utilities
│   └── index.ts             # Main daemon entry
├── templates/
│   └── markdown.hbs         # Markdown export template
├── tests/
│   └── ...
├── package.json
└── tsconfig.json
```

### Configuration File

Location: `~/.clogger/config.json`

```json
{
  "providers": {
    "claude-code": {
      "enabled": true,
      "sessionPaths": ["~/.claude/projects/", "~/.claude-personal/projects/"]
    },
    "chatgpt": {
      "enabled": false,
      "exportPath": "~/Downloads/"
    }
  },
  "outputDirectory": "~/dendron-workspace/private-notes",
  "fileNamingTemplate": "conv.{provider}.{date}.{session-short}.md",
  "metadata": {
    "includeTimestamps": true,
    "includeToolCalls": false,
    "includeThinking": false,
    "truncateToolResults": 1000
  },
  "recording": {
    "captureMode": "full-session",
    "multipleTargets": "replace"
  },
  "monitoring": {
    "pollInterval": 5000,
    "stateUpdateInterval": 10000
  },
  "daemon": {
    "pidFile": "~/.clogger/daemon.pid",
    "logFile": "~/.clogger/daemon.log"
  }
}
```

## Implementation Phases

### Phase 0: Project Scaffolding ✅
- [x] Set up TypeScript project structure with Node 20+, pnpm, Stricli
- [x] Configure build pipeline: tsc (type-check, noEmit) → tsup (ESM bundle, code splitting)
- [x] Configure vitest for testing
- [x] Define Provider interface and base types (`src/providers/base.ts`, `src/types/index.ts`)
- [x] Scaffold Claude Code provider (JSONL parser, session discovery)
- [x] Scaffold core modules (monitor, detector, state, exporter)
- [x] Scaffold all Stricli CLI commands (start, stop, status, export) with lazy loading
- [x] Add `--thinking` and `--toolCalls` flags to export command

**Deliverable**: Full project structure with all modules stubbed, build/test/typecheck passing

### Phase 1: Core Parsing (MVP) ✅
- [x] Two-phase JSONL parser: line parsing → turn aggregation (merges multi-entry assistant turns)
- [x] Tool result linking via `tool_use_id`
- [x] Sidechain filtering (`isSidechain: true` entries skipped)
- [x] Skip non-message types (progress, file-history-snapshot, queue-operation)
- [x] Model name in speaker headings (e.g., `claude-opus-4.6`)
- [x] Markdown exporter: Dendron frontmatter, `renderToString()`, append-to-existing-file support
- [x] Thinking blocks and tool calls in collapsible `<details>` sections
- [x] `--thinking`, `--toolCalls`, `--italics` CLI flags override config defaults
- [x] UTC timestamps via `date-fns-tz`
- [x] 35 tests: parser (11), exporter (14), detector (8), e2e (2)

**Deliverable**: CLI tool that can export existing Claude Code session JSONL to markdown

### Phase 2: Real-time Monitoring ✅
- [x] Session Monitor with chokidar file watching, processSession pipeline
- [x] In-Chat Command handling: `::record`, `::export`, `::capture`, `::stop`
- [x] `::record`/`::capture` = full session overwrite + set recording state
- [x] `::export` = one-shot full session dump (no recording state)
- [x] `::stop` = remove recording state
- [x] Export modes: `overwrite` (full-session commands) vs `create-or-append` (incremental)
- [x] `exportFullSession()` helper for full-session re-export from offset 0
- [x] State Manager with atomic writes, dirty flag, session/recording CRUD
- [x] PID file management in `start.impl.ts` (write on start, clean on shutdown)
- [x] Incremental export: append only new messages to active recording files
- [x] Output path resolution: absolute, relative, @-mention prefix, tilde expansion
- [x] Text cleaning: strip ANSI escape codes, system/IDE tags, collapse whitespace
- [x] H1 (`#`) turn headings (avoids clash with Claude's `##` content headings)
- [x] 50 tests: parser (11), exporter (14), detector (10), state (6), monitor (6), e2e-export (2), e2e-daemon (1)

**Deliverable**: Background daemon that monitors Claude Code sessions and auto-exports based on in-chat commands

### Phase 2.5: Second Provider (Validate Architecture)
- [ ] Implement second provider (e.g., ChatGPT export parser)
- [ ] Test multi-provider monitoring
- [ ] Refine Provider interface based on learnings
- [ ] Update config to support provider selection

**Deliverable**: Proof of multi-LLM architecture with 2+ working providers

### Phase 3: Resilience & Polish
- [ ] Crash recovery and resume logic
- [ ] State cleanup for old sessions
- [ ] Enhanced error handling and logging
- [ ] Configuration management
- [ ] Status/info commands
- [ ] Documentation

**Deliverable**: Production-ready tool with full features

### Phase 4: Enhancements
- [ ] Multiple output format support
- [ ] Filter/exclude certain messages
- [ ] Conversation search/indexing
- [ ] Web dashboard for managing recordings
- [ ] Integration with other note-taking tools

## Cross-Platform Considerations

### Windows vs WSL2

**Path Handling**:
- Use Node.js `path` module exclusively (never hardcode `/` or `\`)
- Convert WSL paths (`/mnt/c/...`) to Windows paths when needed
- Use `os.homedir()` for home directory (works in both)

**File Watching**:
- `chokikar` handles platform differences
- Test on both platforms for performance
- Consider WSL file system performance (might be slower)

**Process Management**:
- Use cross-platform PID file approach
- Consider Windows services vs systemd for auto-start

**Configuration**:
- Store config in platform-appropriate location:
  - Windows: `~/.clogger/`
  - WSL: `~/.clogger/` (maps to Linux home)
- Support both path styles in config

### Testing Strategy

- Unit tests for each component
- Integration tests with mock JSONL files
- End-to-end tests with real session data
- Cross-platform CI (GitHub Actions: Ubuntu + Windows)

## Security & Privacy Considerations

- **Sensitive data**: Conversations may contain API keys, passwords
- **File permissions**: Ensure config and state files are user-only (0600)
- **Output location**: Default to private notes directory
- **Opt-in**: Only record when explicitly requested
- **Exclusion patterns**: Allow users to exclude sensitive tool results

## Future Enhancements

1. **Conversation analytics**: Token usage, session duration, tool usage stats
2. **Search index**: Full-text search across recorded conversations
3. **Tagging system**: Auto-tag conversations by topic/domain
4. **Summary generation**: Use Claude API to generate conversation summaries
5. **Sync support**: Sync to cloud storage or personal knowledge bases
6. **Browser extension**: Record web-based Claude conversations
7. **Graph view**: Visualize conversation relationships and topics

## Design Decisions (Resolved)

1. ✅ **Node version**: Node 20+ for modern ESM, native fetch, and better performance
2. ✅ **CLI framework**: Stricli for type-safe, lazy-loaded commands with zero runtime deps
3. ✅ **Provider architecture**: Pluggable providers for multi-LLM support (Claude Code first)
4. ✅ **Command separation**: Clear distinction between CLI commands (daemon control) and in-chat commands (recording control)
5. ✅ **In-chat command syntax**: Structured commands with `::` prefix (e.g., `::record <filename>`, `::stop`)
6. ✅ **Recording scope**: Capture entire session from start (retroactive)
7. ✅ **Multiple targets**: Replace previous target if new `::record` command issued
8. ✅ **Path handling**: Support full paths (from @-mentions) and relative paths (from workspace root)
9. ✅ **Message format**: Each message gets H1 heading with timestamp (`# Speaker_YYYY-MM-DD_HHMM_SS`)
10. ✅ **User message styling**: Italicized for visual distinction
11. ✅ **Metadata defaults**: Timestamps ON, tool calls/thinking blocks OFF (but configurable)
12. ✅ **Export vs Record vs Capture**: `::export` = one-shot dump, `::record`/`::capture` = dump + continuous recording

### CLI Commands (Daemon Control)

| Command                    | Description                     |
| -------------------------- | ------------------------------- |
| `clogger start`            | Start monitoring daemon         |
| `clogger stop`             | Stop daemon                     |
| `clogger status`           | Show active sessions/recordings |
| `clogger export <session>` | Manually export session         |
| `clogger clean`            | Clean up old state              |
| `clogger config`           | Interactive configuration       |

### In-Chat Commands (Recording Control)

| Command                  | Description                                              | Example                              |
| ------------------------ | -------------------------------------------------------- | ------------------------------------ |
| `::record <filename>`    | Export full session + start continuous recording          | `::record @private-notes/my-conv.md` |
| `::capture <filename>`   | Same as `::record` (alias)                               | `::capture conv.design.md`           |
| `::export <filename>`    | One-shot full session export (no continuous recording)    | `::export session-dump.md`           |
| `::stop`                 | Stop current recording                                   | `::stop`                             |
| `::pause`                | Pause recording (planned)                                | `::pause`                            |
| `::resume`               | Resume paused recording (planned)                        | `::resume`                           |
| `::status`               | Show recording status (planned)                          | `::status`                           |

## Open Questions

1. **Auto-add missing file extension?**: Should `.md` be automatically added if omitted?
2. **Session completion detection**: How to know when a session is "done" vs just idle?
3. **Multi-session files**: Should we support appending multiple sessions to one file, or always one session per file?
4. **Encryption**: Should recorded conversations be encrypted at rest?
5. **Cleanup**: Auto-delete old state/recordings after N days?
6. **Dendron ID format**: Timestamp-based, UUID, or user-configurable?

## Success Metrics

- Successfully monitors and exports 100% of requested sessions
- Zero data loss during crashes/restarts
- < 1s latency from new message to export
- Works on both Windows and WSL2 without configuration changes
- Easy installation and setup (< 5 minutes)

## Installation & Setup (Planned)

```bash
# Install globally
pnpm install -g clogger

# Or with npm
npm install -g clogger

# Configure output directory (interactive)
clogger config

# Start daemon
clogger start

# In Claude Code session, use commands:
# ::record my-conversation.md       # Start recording
# ::stop                            # Stop recording
# ::status                          # Check status

# Stop daemon
clogger stop
```

### Usage Example

```
You: Hey Claude, let's discuss implementing a new feature.

Claude: I'd be happy to help! What feature are you thinking about?

You: ::record @private-notes/conv.feature-x.md

You: I want to add authentication to my app...

[conversation continues, being recorded to the file]

You: ::stop

You: Thanks, that was helpful!
```

## Notes

- **Node version**: Requires Node 20+ (for stable ESM, native fetch, performance improvements)
- **Package manager**: Using `pnpm` for development (faster, better disk efficiency)
- **CLI framework**: Using **Stricli** for TypeScript-first type safety, lazy loading, and zero runtime dependencies
  - Type-safe command definitions with end-to-end type flow
  - Lazy-load command implementations (fast `--help`, small bundle)
  - Context pattern for clean dependency injection
  - Chosen over yargs for better TS support and lighter weight
  - Chosen over commander for type safety and lazy loading
- **Provider architecture**: Multi-LLM support via provider modules
  - Each LLM platform implements the Provider interface
  - Initial provider: Claude Code (JSONL parsing)
  - Future providers: ChatGPT, Cursor, Continue, Aider, etc.
  - Providers are pluggable and can be enabled/disabled in config
- **Command separation**: Clear distinction between CLI commands (daemon control via terminal) and in-chat commands (recording control via conversation text)
- Consider publishing to npm/pnpm for easy distribution
- May want to create companion VSCode extension for in-editor controls
- Could integrate with Dendron's graph features