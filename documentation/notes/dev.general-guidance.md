---
id: djmt4lrod2j7c72n6xjm47i
title: General Guidance
desc: ''
updated: 1770877305486
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

## Architecture

- **ESM-only** (`"type": "module"` in package.json)
- **Build**: tsc for type-checking (`noEmit`), tsup for bundling with code splitting
- **CLI framework**: Stricli — each command has a definition file (`command.ts`) and a lazy-loaded implementation (`command.impl.ts`). The `this` context pattern is used for dependency injection.
- **Provider pattern**: `src/providers/base.ts` defines the Provider interface; each LLM platform gets its own directory under `src/providers/`. Currently only `claude-code`.
- **Two control planes**: CLI commands (daemon lifecycle) vs in-chat commands (`::record`, `::stop` — detected by parsing conversation logs)

## Conventions

- Modern TypeScript: strict mode, verbatimModuleSyntax, bundler moduleResolution
- All imports use `.js` extensions (ESM convention for bundler resolution)
- Tests live in `tests/` (not colocated with source)
- Config/state stored in `~/.clogger/`
