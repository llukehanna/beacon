import { describe, expect, it } from "vitest";
import { FROM_DESK, cameFromDesk } from "./origin";

describe("cameFromDesk", () => {
  it("is true only for the state the Desk's link passes", () => {
    expect(cameFromDesk(FROM_DESK)).toBe(true);
    expect(cameFromDesk(null)).toBe(false);
    expect(cameFromDesk(undefined)).toBe(false);
    expect(cameFromDesk({ from: "pipeline" })).toBe(false);
    expect(cameFromDesk("desk")).toBe(false);
  });
});
