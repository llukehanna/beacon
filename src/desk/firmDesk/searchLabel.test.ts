import { describe, expect, it } from "vitest";
import { searchLabel } from "./deskModel";

describe("searchLabel", () => {
  it("shows the day the search ran next to its name", () => {
    expect(searchLabel("Sell-side of Acme", "2026-09-01T23:30:00.000Z")).toBe(
      "Sell-side of Acme · 2026-09-01",
    );
    expect(searchLabel("Sell-side of Acme", new Date("2026-09-01T00:00:00Z"))).toBe(
      "Sell-side of Acme · 2026-09-01",
    );
  });

  it("leaves the name alone when the run time is missing or unreadable, and is empty with neither", () => {
    expect(searchLabel("Sell-side of Acme", null)).toBe("Sell-side of Acme");
    expect(searchLabel(" Sell-side of Acme ", "not a date")).toBe("Sell-side of Acme");
    expect(searchLabel(null, undefined)).toBe("");
    expect(searchLabel(undefined, "2026-09-01T00:00:00Z")).toBe("2026-09-01");
  });
});
