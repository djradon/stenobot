import type { Provider } from "./base.js";
import type { StenobotConfig } from "../types/index.js";
import { ClaudeCodeProvider } from "./claude-code/index.js";
import { CodexProvider } from "./codex/index.js";

/** Registry of available LLM providers */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(config?: StenobotConfig) {
    // Register built-in providers with config-driven settings
    const claudeConfig = config?.providers["claude-code"];
    if (claudeConfig?.enabled ?? true) {
      this.register(new ClaudeCodeProvider(claudeConfig?.sessionPaths));
    }

    const codexConfig = config?.providers["codex"];
    if (codexConfig?.enabled ?? true) {
      this.register(new CodexProvider(codexConfig?.sessionPaths));
    }
  }

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  getAll(): Provider[] {
    return [...this.providers.values()];
  }

  getEnabled(enabledNames: string[]): Provider[] {
    return enabledNames
      .map((name) => this.providers.get(name))
      .filter((p): p is Provider => p !== undefined);
  }
}
