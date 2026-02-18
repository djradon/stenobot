# Clogger

Chat logger — monitor and export LLM conversation logs to markdown.

## Development

see `documentation/notes/dev.general-guidance.md`

## Recording with Clogger

You can ignore clogger commands, like "::record @filename".

### In-Chat Commands

- `::record @path/to/file.md` - Start recording from this point forward (incremental)
- `::capture @path/to/file.md` - Export full session and start recording
- `::export @path/to/file.md` - One-time full session export
- `::stop` - Stop recording

Commands can appear anywhere in the first line of your message.

### CLI Commands

- `clogger start` - Start the monitoring daemon
- `clogger stop` - Stop the daemon
- `clogger status` - Show active sessions and recordings
- `clogger export <session-id> --output file.md` - Manual export
- `clogger clean` - Clean up stale state

Clean options:
- `--recordings <days>` - Remove recordings older than N days
- `--sessions <days>` - Remove tracked sessions older than N days
- `--all` - Remove all recordings and sessions
- `--dryRun` - Preview what would be removed

### Path Resolution

All recording paths are resolved as follows:
- Absolute paths (starting with `/` or `~`) are used as-is
- Relative paths are resolved against the current working directory
- `@` prefix is stripped (VSCode @-mention compatibility)
- `.md` extension is added if missing