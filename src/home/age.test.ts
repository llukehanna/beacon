import { describe, expect, it } from "vitest";
import { relativeAge } from "./age";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeAge", () => {
  it("reads minutes, hours and days", () => {
    expect(relativeAge(ago(30_000), NOW)).toBe("now");
    expect(relativeAge(ago(5 * MIN), NOW)).toBe("5m");
    expect(relativeAge(ago(2 * HOUR + 40 * MIN), NOW)).toBe("2h");
    expect(relativeAge(ago(23 * HOUR), NOW)).toBe("23h");
    expect(relativeAge(ago(3 * DAY), NOW)).toBe("3d");
  });

  it("moves to weeks and months for old items", () => {
    expect(relativeAge(ago(21 * DAY), NOW)).toBe("3w");
    expect(relativeAge(ago(90 * DAY), NOW)).toBe("3mo");
  });

  it("never reads a future time as negative", () => {
    expect(relativeAge(new Date(NOW + HOUR).toISOString(), NOW)).toBe("now");
  });

  it("has no age without a readable time", () => {
    expect(relativeAge(null, NOW)).toBeNull();
    expect(relativeAge(undefined, NOW)).toBeNull();
    expect(relativeAge("soon", NOW)).toBeNull();
  });
});
