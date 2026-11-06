import { describe, expect, it } from "vitest";
import { docLines } from "./sourceHighlight";

const body =
  "Header line.\nThe firm reports 12 fee-earning professionals\nacross two offices.\nClosing.";

describe("docLines", () => {
  it("numbers every line from 1", () => {
    const { lines } = docLines(body, null);
    expect(lines.map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(lines.every((l) => !l.cited)).toBe(true);
  });

  it("marks a quote on one line", () => {
    const { lines, found } = docLines(body, "reports 12 fee-earning");
    expect(found).toBe(true);
    expect(lines[1].cited).toBe(true);
    expect(lines[1].parts).toEqual([
      { text: "The firm ", mark: false },
      { text: "reports 12 fee-earning", mark: true },
      { text: " professionals", mark: false },
    ]);
    expect(lines[0].cited).toBe(false);
  });

  it("marks a quote that runs across lines on each line it touches", () => {
    const { lines } = docLines(body, "professionals\nacross two");
    expect(lines.map((l) => l.cited)).toEqual([false, true, true, false]);
    expect(lines[2].parts[0]).toEqual({ text: "across two", mark: true });
  });

  it("reports a quote that is not in the document", () => {
    const { lines, found } = docLines(body, "never written");
    expect(found).toBe(false);
    expect(lines.some((l) => l.cited)).toBe(false);
  });
});
