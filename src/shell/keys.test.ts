import { describe, expect, it } from "vitest";
import { GO_KEYS, isTypingTarget } from "./keys";

// The unit tests run without a DOM, so elements are stand-ins with the properties the guard reads.
const el = (tagName: string, extra: Record<string, unknown> = {}) =>
  ({ tagName, ...extra }) as unknown as Element;

describe("isTypingTarget", () => {
  it("is true for an input, a textarea and a select", () => {
    expect(isTypingTarget(el("INPUT"))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("SELECT"))).toBe(true);
  });

  it("is true for a contenteditable element", () => {
    expect(isTypingTarget(el("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("is false for a button and for null", () => {
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("GO_KEYS", () => {
  it("maps U to Rules, since R is Review", () => {
    expect(GO_KEYS.u).toBe("/rules");
    expect(GO_KEYS.r).toBe("/review");
  });

  it("reaches all seven routes", () => {
    expect(Object.values(GO_KEYS).sort()).toEqual(
      ["/", "/accuracy", "/desk", "/mandate", "/pipeline", "/review", "/rules"].sort(),
    );
  });
});
