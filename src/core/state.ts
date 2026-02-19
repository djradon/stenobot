import fs from "node:fs/promises";
import path from "node:path";
import type { AppState } from "../types/index.js";
import { getStenobotDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

const STATE_FILE = "state.json";

const DEFAULT_STATE: AppState = {
  sessions: {},
  recordings: {},
};

export class StateManager {
  private state: AppState = structuredClone(DEFAULT_STATE);
  private readonly statePath: string;
  private dirty = false;

  constructor(stateDir?: string) {
    this.statePath = path.join(stateDir ?? getStenobotDir(), STATE_FILE);
  }

  /** Load persisted state from disk */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, "utf-8");
      this.state = JSON.parse(raw) as AppState;
      logger.info("State loaded", { path: this.statePath });
    } catch {
      this.state = structuredClone(DEFAULT_STATE);
      logger.info("No existing state found, starting fresh");
    }
  }

  /** Persist current state to disk (atomic write) */
  async save(): Promise<void> {
    if (!this.dirty) return;

    const dir = path.dirname(this.statePath);
    await fs.mkdir(dir, { recursive: true });

    const tmpPath = `${this.statePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    await fs.rename(tmpPath, this.statePath);

    this.dirty = false;
    logger.debug("State saved", { path: this.statePath });
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  updateSession(
    sessionId: string,
    update: Partial<AppState["sessions"][string]>,
  ): void {
    this.state.sessions[sessionId] = {
      ...this.state.sessions[sessionId]!,
      ...update,
    };
    this.dirty = true;
  }

  setRecording(
    sessionId: string,
    recording: AppState["recordings"][string],
  ): void {
    this.state.recordings[sessionId] = recording;
    this.dirty = true;
  }

  removeRecording(sessionId: string): void {
    delete this.state.recordings[sessionId];
    this.dirty = true;
  }

  getRecording(
    sessionId: string,
  ): AppState["recordings"][string] | undefined {
    return this.state.recordings[sessionId];
  }

  removeSession(sessionId: string): void {
    delete this.state.sessions[sessionId];
    delete this.state.recordings[sessionId];
    this.dirty = true;
  }

  /** Remove all sessions and recordings from state */
  clearAll(): void {
    this.state = structuredClone(DEFAULT_STATE);
    this.dirty = true;
  }
}
