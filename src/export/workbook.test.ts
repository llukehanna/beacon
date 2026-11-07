import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exportRows } from "../../shared/exportRows";
import { buildWorkbook } from "./workbook";

describe("buildWorkbook", () => {
  it("writes formula-like text as string cells with its literal text", async () => {
    const { rows, citations } = exportRows(
      [
        { firmId: "f1", firmName: "=Evil", hqCountry: "@home" },
        { firmId: "f2", firmName: "-Firm", hqCountry: "+44" },
      ],
      [],
    );
    const blob = await buildWorkbook(rows, citations);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    const strings = [
      ...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<t[^>]*>([^<]*)<\/t>/g),
    ].map((m) => m[1]);

    // No cell is a formula.
    expect(sheet).not.toMatch(/<f[ >]/);
    // The text is kept as it is, with no apostrophe added, in string cells.
    for (const text of ["=Evil", "-Firm", "@home", "+44"]) {
      expect(strings).toContain(text);
    }
    expect(strings.some((s) => s.startsWith("'"))).toBe(false);
    expect(sheet).toMatch(/<c r="A2"[^>]*t="s"/);
    expect(sheet).toMatch(/<c r="A3"[^>]*t="s"/);
  });
});
