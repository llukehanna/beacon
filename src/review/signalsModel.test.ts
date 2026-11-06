import { describe, expect, it } from "vitest";
import { buildSignalsView } from "./signalsModel";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const signal = (id: string, over: Record<string, unknown> = {}) => ({
  signalId: id,
  firmId: "acme",
  kind: "departure",
  effectiveDate: "2026-11-05T12:00:00.000Z",
  appliedAt: "2026-11-05T12:00:00.000Z",
  headline: "Acme loses a partner",
  axis: "fee_generating_count",
  newValue: "3",
  ...over,
});
const firms = [{ firmId: "acme", firmName: "Acme Advisors" }];

describe("buildSignalsView", () => {
  it("lists applied signals newest first with the firm, kind, axis moved and the synthetic label", () => {
    const view = buildSignalsView(
      [
        signal("old", { effectiveDate: "2026-10-20T00:00:00.000Z" }),
        signal("new"),
        signal("mid", { effectiveDate: "2026-11-01T00:00:00.000Z", kind: "senior_hire" }),
      ],
      firms,
      NOW,
    );
    expect(view.total).toBe(3);
    expect(view.rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(view.rows[0]).toEqual({
      id: "new",
      headline: "Acme loses a partner",
      firmId: "acme",
      firmName: "Acme Advisors",
      kind: "Departure",
      age: "1d",
      date: "2026-11-05",
      moved: "Fee-earning heads → 3",
      label: "Synthetic market signal",
    });
    expect(view.rows[1].kind).toBe("Senior hire");
  });

  it("leaves out a signal that has not come due yet", () => {
    const view = buildSignalsView(
      [signal("later", { effectiveDate: "2026-11-07T01:00:00.000Z", appliedAt: undefined })],
      firms,
      NOW,
    );
    expect(view).toEqual({ rows: [], total: 0 });
  });

  it("shows the newest few and counts them all", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      signal(`s${String(i).padStart(2, "0")}`, {
        effectiveDate: new Date(NOW - (i + 1) * 3_600_000).toISOString(),
      }),
    );
    const view = buildSignalsView(many, firms, NOW, 5);
    expect(view.total).toBe(12);
    expect(view.rows.map((r) => r.id)).toEqual(["s00", "s01", "s02", "s03", "s04"]);
  });

  it("falls back to the firm id when the firm is not loaded, and names an acquisition's outcome", () => {
    const view = buildSignalsView(
      [signal("a", { firmId: "ghost", kind: "acquisition", axis: undefined, newValue: undefined })],
      [],
      NOW,
    );
    expect(view.rows[0]).toMatchObject({
      firmName: "ghost",
      kind: "Acquisition",
      moved: "Market outcome: acquired by a competitor",
    });
  });
});
