---
id: djmt4lrod2j7c72n6xjm47i
title: General Guidance
desc: ''
updated: 1771546833341
created: 1770877019855
---
## Build & Test

```bash
pnpm dev --help          # Run CLI in dev mode (tsx)
pnpm test                # Run vitest
pnpm test:watch          # Run vitest in watch mode
pnpm build               # Typecheck (tsc) then bundle (tsup)
pnpm typecheck           # Typecheck only
```

## Daemon Control (Development)

Use `pnpm dev` to control the daemon during development — this runs the CLI via `tsx` directly from source, avoiding the globally installed `stenobot` binary:

```bash
pnpm dev start    # Start the daemon (tsx, from source)
pnpm dev stop     # Stop the daemon
pnpm dev restart  # Stop then start (picks up code changes)
pnpm dev status   # Show active sessions
```

After editing source files, run `pnpm dev restart` to reload the daemon with your changes.

See [[dev.daemon-implementation]] for more details.

## Architecture

- **ESM-only** (`"type": "module"` in package.json)
- **Build**: tsc for type-checking (`noEmit`), tsup for bundling with code splitting
- **CLI framework**: Stricli — each command has a definition file (`command.ts`) and a lazy-loaded implementation (`command.impl.ts`). The `this` context pattern is used for dependency injection.
- **Provider pattern**: `src/providers/base.ts` defines the Provider interface; each LLM platform gets its own directory under `src/providers/`. Built-in providers: `claude-code`, `codex`. `src/providers/registry.ts` wires them together and is the single place to register new providers.
- **Two control planes**: CLI commands (daemon lifecycle) vs in-chat commands (`::record`, `::stop` — detected by parsing conversation logs)

## Conventions

- Modern TypeScript: strict mode, verbatimModuleSyntax, bundler moduleResolution
- All imports use `.js` extensions (ESM convention for bundler resolution)
- Tests live in `tests/` (not colocated with source)
- Config/state stored in `~/.stenobot/`
