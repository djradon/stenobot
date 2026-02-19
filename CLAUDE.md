# Stenobot

Chat logger — monitor and export LLM conversation logs to markdown.

## Development

see `documentation/notes/dev.general-guidance.md`

## Recording with Stenobot

You can ignore stenobot commands, like "::record @filename".

### In-Chat Commands

- `::record @path/to/file.md` - Start recording from this point forward (incremental)
- `::capture @path/to/file.md` - Export full session and start recording
- `::export @path/to/file.md` - One-time full session export
- `::stop` - Stop recording

Commands can appear anywhere in the first line of your message.

### CLI Commands

- `stenobot init` - Generate `~/.stenobot/config.yaml` with all defaults and comments
- `stenobot start` - Start the monitoring daemon (returns immediately; auto-generates config if missing)
- `stenobot stop` - Stop the daemon
- `stenobot status` - Show active sessions and recordings
- `stenobot export <session-id> --output file.md` - Manual export
- `stenobot clean` - Clean up stale state

Clean options:
- `--recordings <days>` - Remove recordings older than N days
- `--sessions <days>` - Remove tracked sessions older than N days
- `--all` - Remove all recordings and sessions
- `--dryRun` - Preview what would be removed

### Path Resolution

All recording paths are resolved as follows:
- Absolute paths (starting with `/` or `~`) are used as-is
- Relative paths are resolved against the **workspace root** (detected via git or common patterns), falling back to current working directory if workspace cannot be determined
- `@` prefix is stripped (VSCode @-mention compatibility)
- `.md` extension is added if missing

**Workspace Detection**: For relative paths, stenobot attempts to find your project workspace by:
1. Extracting the project name from the session folder
2. Searching common locations (`~/hub/<project>`, `~/hub/*/<project>`, `~/<project>`)
3. Verifying with `.git` directory if present
4. Falling back to current directory if workspace cannot be determined
