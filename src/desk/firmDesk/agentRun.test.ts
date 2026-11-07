import { describe, expect, it } from "vitest";
import { agentHasRun } from "./agentRun";

describe("agentHasRun", () => {
  it("is false with no findings", () => {
    expect(agentHasRun([])).toBe(false);
  });

  it("is false when every finding is the analyst's own", () => {
    expect(agentHasRun([{ provider: "analyst" }, { provider: "analyst" }])).toBe(false);
  });

  it("is false when the only finding is a synthetic market signal's", () => {
    expect(agentHasRun([{ provider: "market_signal" }])).toBe(false);
    expect(agentHasRun([{ provider: "market_signal" }, { provider: "dealdb" }])).toBe(true);
  });

  it("is true for a provider finding, a corroborated one, or the agent's abstention", () => {
    expect(agentHasRun([{ provider: "dealdb" }])).toBe(true);
    expect(agentHasRun([{ provider: "dealdb+filings" }])).toBe(true);
    expect(agentHasRun([{ provider: "agent" }])).toBe(true);
  });

  it("stays true once an analyst has also entered values", () => {
    expect(agentHasRun([{ provider: "analyst" }, { provider: "websearch" }])).toBe(true);
  });

  it("ignores findings that name no source", () => {
    expect(agentHasRun([{}, { provider: null }, { provider: " " }])).toBe(false);
  });
});
