import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateManager } from "../src/core/state.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clogger-state-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("StateManager", () => {
  it("initializes with default state when no file exists", async () => {
    const state = new StateManager(tmpDir);
    await state.load();

    const s = state.getState();
    expect(s.sessions).toEqual({});
    expect(s.recordings).toEqual({});
  });

  it("round-trips state through save and load", async () => {
    const state = new StateManager(tmpDir);
    await state.load();

    state.updateSession("session-1", {
      filePath: "/tmp/test.jsonl",
      lastProcessedOffset: 1234,
      lastProcessedTimestamp: "2026-02-11T00:00:00Z",
    });
    state.setRecording("session-1", {
      outputFile: "/tmp/output.md",
      started: "2026-02-11T00:00:00Z",
      lastExported: "2026-02-11T00:01:00Z",
    });

    await state.save();

    // Load into a fresh instance
    const state2 = new StateManager(tmpDir);
    await state2.load();

    const s = state2.getState();
    expect(s.sessions["session-1"]!.lastProcessedOffset).toBe(1234);
    expect(s.recordings["session-1"]!.outputFile).toBe("/tmp/output.md");
  });

  it("skips save when state is not dirty", async () => {
    const state = new StateManager(tmpDir);
    await state.load();

    // Save without any changes — should not create file
    await state.save();

    const stateFile = path.join(tmpDir, "state.json");
    await expect(fs.access(stateFile)).rejects.toThrow();
  });

  it("saves when state is dirty", async () => {
    const state = new StateManager(tmpDir);
    await state.load();

    state.updateSession("s1", {
      filePath: "/tmp/test.jsonl",
      lastProcessedOffset: 0,
      lastProcessedTimestamp: "2026-02-11T00:00:00Z",
    });

    await state.save();

    const stateFile = path.join(tmpDir, "state.json");
    const raw = await fs.readFile(stateFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.sessions.s1).toBeDefined();
  });

  it("removes recordings", async () => {
    const state = new StateManager(tmpDir);
    await state.load();

    state.setRecording("s1", {
      outputFile: "/tmp/out.md",
      started: "2026-02-11T00:00:00Z",
      lastExported: "2026-02-11T00:00:00Z",
    });
    expect(state.getRecording("s1")).toBeDefined();

    state.removeRecording("s1");
    expect(state.getRecording("s1")).toBeUndefined();
  });

  it("performs atomic writes (temp file + rename)", async () => {
    const state = new StateManager(tmpDir);
    await state.load();

    state.updateSession("s1", {
      filePath: "/tmp/test.jsonl",
      lastProcessedOffset: 42,
      lastProcessedTimestamp: "2026-02-11T00:00:00Z",
    });

    await state.save();

    // Temp file should not remain
    const tmpFile = path.join(tmpDir, "state.json.tmp");
    await expect(fs.access(tmpFile)).rejects.toThrow();

    // Actual file should exist with correct content
    const stateFile = path.join(tmpDir, "state.json");
    const raw = await fs.readFile(stateFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.sessions.s1.lastProcessedOffset).toBe(42);
  });
});
