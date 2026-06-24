import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "./store.js";
import { DEFAULT_CATALOG_SOURCES } from "../skills/defaults.js";

describe("store: default catalog sources", () => {
  it("seeds the shipped defaults on a fresh file db, with their official flags", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tr-catdef-"));
    try {
      const store = createStore(path.join(dir, "t.db"));
      const got = store.listCatalogSources();
      expect(got.map((s) => s.source).sort()).toEqual(DEFAULT_CATALOG_SOURCES.map((d) => d.source).sort());
      for (const d of DEFAULT_CATALOG_SOURCES) {
        expect(got.find((s) => s.source === d.source)?.official).toBe(d.official);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not seed an in-memory db (tests / ephemeral start clean)", () => {
    expect(createStore(":memory:").listCatalogSources()).toEqual([]);
  });

  it("is once-only: a removed default stays gone after the next boot", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tr-catdef-"));
    const file = path.join(dir, "t.db");
    try {
      const victim = DEFAULT_CATALOG_SOURCES[0].source;
      const first = createStore(file);
      first.removeCatalogSource(victim);
      expect(first.listCatalogSources().some((s) => s.source === victim)).toBe(false);
      // reopen the same db → boot seed runs again but the flag is set, so nothing re-seeds
      const second = createStore(file);
      expect(second.listCatalogSources().some((s) => s.source === victim)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
