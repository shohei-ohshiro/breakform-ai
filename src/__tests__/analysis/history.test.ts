import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getHistory,
  addHistoryEntry,
  clearHistory,
  __internal,
} from "@/lib/analysis/history";

/**
 * vitest runs in `node` environment by default, so `window` is undefined.
 * The history module is defensive about that, but to exercise the real paths
 * we install a tiny in-memory localStorage stub.
 */
class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

// Stash a MemoryStorage on globalThis — the history module reads window.localStorage
// at call time, so we just need the shape to line up at runtime.
const g = globalThis as unknown as { window?: { localStorage: MemoryStorage } };

describe("analysis history (localStorage)", () => {
  beforeEach(() => {
    g.window = { localStorage: new MemoryStorage() };
    // Ensure feature flag is on (default true) and no stray env overrides.
    delete process.env.NEXT_PUBLIC_FEATURE_HISTORY_LOCAL_STORAGE;
  });

  afterEach(() => {
    g.window = undefined;
  });

  const sampleEntry = {
    technique: "middle_split" as const,
    trickNameJa: "180度開脚",
    score: 72,
    qualityLevel: "reference" as const,
    reliability: 0.83,
    headline: "あと一歩で170度",
    topLimiter: "前傾が浅い",
  };

  it("returns empty when nothing has been saved", () => {
    expect(getHistory()).toEqual([]);
  });

  it("round-trips an entry through localStorage", () => {
    const updated = addHistoryEntry(sampleEntry);
    expect(updated).toHaveLength(1);
    expect(updated[0].technique).toBe("middle_split");
    expect(updated[0].id).toMatch(/^\d+-[a-z0-9]+$/);
    expect(typeof updated[0].timestamp).toBe("number");

    const fetched = getHistory();
    expect(fetched).toHaveLength(1);
    expect(fetched[0].headline).toBe("あと一歩で170度");
  });

  it("orders entries newest-first", () => {
    addHistoryEntry({ ...sampleEntry, score: 60 });
    addHistoryEntry({ ...sampleEntry, score: 70 });
    addHistoryEntry({ ...sampleEntry, score: 80 });
    const list = getHistory();
    expect(list.map((e) => e.score)).toEqual([80, 70, 60]);
  });

  it(`caps history at ${__internal.MAX_ENTRIES} entries`, () => {
    for (let i = 0; i < __internal.MAX_ENTRIES + 5; i++) {
      addHistoryEntry({ ...sampleEntry, score: i });
    }
    const list = getHistory();
    expect(list).toHaveLength(__internal.MAX_ENTRIES);
    // Newest first: scores 24..5
    expect(list[0].score).toBe(__internal.MAX_ENTRIES + 4);
    expect(list[list.length - 1].score).toBe(5);
  });

  it("clearHistory empties the list", () => {
    addHistoryEntry(sampleEntry);
    expect(getHistory()).toHaveLength(1);
    clearHistory();
    expect(getHistory()).toHaveLength(0);
  });

  it("returns empty when the feature flag is off", () => {
    process.env.NEXT_PUBLIC_FEATURE_HISTORY_LOCAL_STORAGE = "false";
    addHistoryEntry(sampleEntry);
    expect(getHistory()).toEqual([]);
  });

  it("survives malformed stored JSON", () => {
    g.window!.localStorage.setItem(__internal.STORAGE_KEY, "not-json");
    expect(getHistory()).toEqual([]);
  });

  it("filters out malformed entries from storage", () => {
    const raw = JSON.stringify([
      { id: "x", timestamp: 1, technique: "middle_split", score: 50 },
      { bogus: true },
      null,
    ]);
    g.window!.localStorage.setItem(__internal.STORAGE_KEY, raw);
    const list = getHistory();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("x");
  });
});
