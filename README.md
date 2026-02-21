# stenobot

Never lose an LLM conversation.

Stenobot monitors local LLM sessions across tools and turns them into structured Markdown logs.

Daemon for live sync. CLI for one-off exports.

Local-first. Markdown-native.

## Install

```bash
npm install -g stenobot
```

Or from source:

```bash
git clone https://github.com/djradon/stenobot.git
cd stenobot
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

```bash
# Start the daemon (returns immediately — runs in background)
stenobot start

# In any Claude Code or Codex CLI or IDE plugin conversation, type:
#   ::capture my-conversation.md      → export full session + keep recording
#   ::stop                            → stop recording
```

That's it. The daemon watches for session activity and responds to in-chat commands automatically.

## CLI Commands

| Command                        | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `stenobot init`                | Generate `~/.stenobot/config.yaml` with all defaults |
| `stenobot start`               | Start the monitoring daemon (returns immediately)    |
| `stenobot stop`                | Stop the daemon                                      |
| `stenobot restart`             | Restart the daemon (`stop` then `start`)             |
| `stenobot status`              | Show active sessions and recordings                  |
| `stenobot export <session-id>` | One-shot export of a session to markdown             |
| `stenobot clean`               | Clean recordings and/or sessions                     |

### Export flags

```bash
stenobot export <session-id> --output path/to/file.md
stenobot export <session-id> --thinking    # include thinking blocks
stenobot export <session-id> --toolCalls   # include tool call details
```

### Clean flags

```bash
stenobot clean --recordings <days>   # remove recordings older than N days
stenobot clean --sessions <days>     # remove tracked sessions older than N days
stenobot clean --all                 # remove all recordings and sessions
stenobot clean --dryRun              # preview what would be removed without making changes
```

## In-Chat Commands

Type these directly in a Claude Code conversation while the daemon is running:

| Command            | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `::capture <file>` | Export full pre-existing session + record future turns |
| `::record <file>`  | Forward-only recording (no retroactive export)         |
| `::export <file>`  | One-shot full session export (no continuous recording) |
| `::stop`           | Stop the current recording                             |

File paths can be absolute, relative to workspace root, or use `@` prefix (VSCode file mentions) and `~` (home directory). The `.md` extension is added automatically if omitted.

**Note:** These commands are detected by parsing the conversation log — Claude will see them and respond as part of the conversation. You can embed them naturally, e.g.:

> I'm going to ::capture to @documentation/notes/conv.design-review.md

The daemon picks up the `::capture` (or `::record`) regardless of surrounding text, and ignores any " to " before the destination file "argument."

To avoid LLM confusion, you might want to add an instruction like 'You can ignore StenoBot commands, like "::record @filename".' to your prompt or CLAUDE.md file.

If the target file already has YAML frontmatter (e.g., a Dendron note), stenobot preserves it and only writes the conversation content below.

## Configuration

Config lives at `~/.stenobot/config.yaml`. Generate it with:

```bash
stenobot init           # create with all defaults and comments
stenobot init --force   # overwrite existing config
```

It is also auto-generated on the first `stenobot start`. All fields are optional — defaults are used for anything not specified. Example override:

```yaml
metadata:
  includeToolCalls: true
  italicizeUserMessages: true
```

Run `stenobot init` to see the full annotated config with all available settings and their defaults.

## Development

```bash
pnpm dev             # Run CLI in dev mode (tsx)
pnpm test            # Run vitest
pnpm build           # Typecheck (tsc) then bundle (tsup)
pnpm typecheck       # Typecheck only
```

## License


