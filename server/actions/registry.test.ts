import { describe, expect, it } from "vitest";
import { ACTION_PARAMS } from "../../shared/actionParams.js";
import { ACTION_NAMES } from "../../shared/schema.js";
import { ACTIONS } from "./registry.js";

describe("action registry", () => {
  it("implements every action the frontend can call", () => {
    expect(ACTION_NAMES.filter((n) => ACTIONS[n] === undefined)).toEqual([]);
  });

  it("validates each action against the parameters the client is typed with", () => {
    for (const name of ACTION_NAMES) {
      expect(ACTIONS[name].params).toBe(ACTION_PARAMS[name]);
    }
  });

  it("registers nothing the frontend cannot name", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...ACTION_NAMES].sort());
  });
});
