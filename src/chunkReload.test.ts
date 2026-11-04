import { describe, expect, it } from "vitest";
import { claimChunkReload, isChunkLoadError } from "./chunkReload";

function memoryStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("isChunkLoadError", () => {
  it("recognizes stale-chunk import failures across browsers", () => {
    expect(
      isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/x.js")),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
  });
  it("leaves other errors alone", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("claimChunkReload", () => {
  it("allows one reload, then refuses until the window passes", () => {
    const store = memoryStore();
    expect(claimChunkReload(store, 1_000_000)).toBe(true);
    expect(claimChunkReload(store, 1_005_000)).toBe(false);
    expect(claimChunkReload(store, 1_100_000)).toBe(true);
  });
  it("never reloads without usable storage", () => {
    expect(claimChunkReload(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    expect(claimChunkReload(broken)).toBe(false);
  });
});
