import { describe, expect, it } from "vitest";
import { FIRM_DECISION_KEYS, GO_KEYS, firmDecisionKey, goKeysIgnore, isTypingTarget } from "./keys";

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

describe("firmDecisionKey", () => {
  const press = (
    key: string,
    mods: Partial<Record<"shiftKey" | "metaKey" | "ctrlKey" | "altKey", boolean>> = {},
  ) => ({
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });

  it("maps Shift+Q, Shift+A and Shift+R to qualify, advance and pass", () => {
    expect(firmDecisionKey(press("Q", { shiftKey: true }))).toBe("qualify");
    expect(firmDecisionKey(press("A", { shiftKey: true }))).toBe("advance");
    expect(firmDecisionKey(press("R", { shiftKey: true }))).toBe("pass");
  });

  it("leaves the plain letters to the selected axis", () => {
    expect(firmDecisionKey(press("r"))).toBeNull();
    expect(firmDecisionKey(press("q"))).toBeNull();
  });

  it("ignores chords with Cmd, Ctrl or Alt", () => {
    expect(firmDecisionKey(press("R", { shiftKey: true, metaKey: true }))).toBeNull();
    expect(firmDecisionKey(press("R", { shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(firmDecisionKey(press("R", { shiftKey: true, altKey: true }))).toBeNull();
  });

  it("labels each key the way the hints show it", () => {
    expect(Object.values(FIRM_DECISION_KEYS).map((k) => k.label)).toEqual(["⇧Q", "⇧A", "⇧R"]);
  });
});

describe("goKeysIgnore", () => {
  const press = (key: string, mods: Record<string, boolean> = {}) => ({
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    ...mods,
  });

  it("lets plain letters and a typed ? through", () => {
    expect(goKeysIgnore(press("g"))).toBe(false);
    expect(goKeysIgnore(press("a"))).toBe(false);
    expect(goKeysIgnore(press("?", { shiftKey: true }))).toBe(false);
  });

  it("leaves Shift chords to the screens, so G then Shift+A is the Desk's Advance", () => {
    expect(goKeysIgnore(press("A", { shiftKey: true }))).toBe(true);
    expect(goKeysIgnore(press("G", { shiftKey: true }))).toBe(true);
    expect(goKeysIgnore(press("Shift", { shiftKey: true }))).toBe(true);
  });

  it("still ignores Ctrl, Cmd and Alt chords and held-down repeats", () => {
    expect(goKeysIgnore(press("g", { ctrlKey: true }))).toBe(true);
    expect(goKeysIgnore(press("g", { metaKey: true }))).toBe(true);
    expect(goKeysIgnore(press("g", { altKey: true }))).toBe(true);
    expect(goKeysIgnore(press("g", { repeat: true }))).toBe(true);
  });
});
