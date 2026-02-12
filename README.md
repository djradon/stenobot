# clogger

Chat logger — monitor and export LLM conversation logs to markdown.

Clogger runs as a background daemon that watches your Claude Code session files. When you type `::record my-notes.md` in a conversation, it exports the full session to markdown and continues appending new messages as you chat. Works great with any markdown-based note system.

## Install

```bash
# From source
git clone https://github.com/djradon/clogger.git
cd clogger
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

```bash
# Start the daemon
clogger start

# In any Claude Code conversation, type:
#   ::record my-conversation.md       → export full session + keep recording
#   ::stop                            → stop recording

# Stop the daemon
clogger stop
```

That's it. The daemon watches `~/.claude/projects/` and `~/.claude-personal/projects/` for session activity and responds to in-chat commands automatically.

## CLI Commands

| Command | Description |
|---------|-------------|
| `clogger start` | Start the monitoring daemon |
| `clogger stop` | Stop the daemon |
| `clogger status` | Show active sessions and recordings |
| `clogger export <session-id>` | One-shot export of a session to markdown |

### Export flags

```bash
clogger export <session-id> --output path/to/file.md
clogger export <session-id> --thinking    # include thinking blocks
clogger export <session-id> --toolCalls   # include tool call details
```

## In-Chat Commands

Type these directly in a Claude Code conversation while the daemon is running:

| Command | Description |
|---------|-------------|
| `::record <file>` | Export full session + start continuous recording |
| `::capture <file>` | Same as `::record` (alias) |
| `::export <file>` | One-shot full session export (no continuous recording) |
| `::stop` | Stop the current recording |

File paths can be absolute, relative to workspace root, or use `@` prefix (VSCode file mentions) and `~` (home directory). The `.md` extension is added automatically if omitted.

**Note:** These commands are detected by parsing the conversation log — Claude will see them and respond as part of the conversation. You can embed them naturally, e.g.:

> I'm going to ::record this conversation to @documentation/notes/conv.design-review.md

The daemon picks up the `::record` regardless of surrounding text.

If the target file already has YAML frontmatter (e.g., a Dendron note), clogger preserves it and only writes the conversation content below.

## Configuration

Config lives at `~/.clogger/config.json`. All fields are optional — defaults are used for anything not specified:

```json
{
  "metadata": {
    "includeToolCalls": true,
    "includeThinking": false,
    "italicizeUserMessages": true
  }
}
```

### Full default config

```json
{
  "providers": {
    "claude-code": {
      "enabled": true,
      "sessionPaths": ["~/.claude/projects/", "~/.claude-personal/projects/"]
    }
  },
  "outputDirectory": "~/clogger-output",
  "metadata": {
    "includeTimestamps": true,
    "includeToolCalls": false,
    "includeThinking": false,
    "italicizeUserMessages": false,
    "truncateToolResults": 1000
  },
  "monitoring": {
    "pollInterval": 60000,
    "stateUpdateInterval": 10000,
    "maxSessionAge": 600000
  },
  "daemon": {
    "pidFile": "~/.clogger/daemon.pid",
    "logFile": "~/.clogger/daemon.log"
  }
}
```

## Development

```bash
pnpm dev --help      # Run CLI in dev mode (tsx)
pnpm test            # Run vitest
pnpm build           # Typecheck (tsc) then bundle (tsup)
pnpm typecheck       # Typecheck only
```

## License

MIT
