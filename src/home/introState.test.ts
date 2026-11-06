import { describe, expect, it } from "vitest";
import { dismissIntro, introDismissed } from "./introState";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("intro state", () => {
  it("is not dismissed until dismissIntro runs", () => {
    const s = memoryStorage();
    expect(introDismissed(s)).toBe(false);
    dismissIntro(s);
    expect(introDismissed(s)).toBe(true);
  });

  it("introDismissed tolerates storage errors", () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
    };
    expect(() => introDismissed(broken)).not.toThrow();
    expect(introDismissed(broken)).toBe(false);
  });

  it("dismissIntro tolerates storage errors", () => {
    const broken = {
      setItem: (): void => {
        throw new Error("quota");
      },
    };
    expect(() => dismissIntro(broken)).not.toThrow();
  });

  it("introDismissed(null) is false and dismissIntro(null) is a no-op", () => {
    expect(introDismissed(null)).toBe(false);
    expect(() => dismissIntro(null)).not.toThrow();
  });
});
