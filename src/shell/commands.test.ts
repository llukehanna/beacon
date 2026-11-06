import { describe, expect, it } from "vitest";
import { type Command, pageCommands, paletteSections, registerCommands } from "./commands";

const cmd = (id: string, label: string, group: Command["group"]): Command => ({
  id,
  label,
  group,
  run: () => undefined,
});

const FIRMS = Array.from({ length: 12 }, (_, i) => cmd(`f${i}`, `Firm ${i}`, "Firms"));
const ALL: Command[] = [
  cmd("a1", "Show keyboard shortcuts", "Actions"),
  cmd("g1", "Desk", "Go to"),
  cmd("g2", "Rules", "Go to"),
  cmd("m1", "Nordic advisory roll-up", "Mandates"),
  ...FIRMS,
];

describe("paletteSections", () => {
  it("lists actions, routes and mandates but not firms when nothing is typed", () => {
    const groups = paletteSections("", ALL).map((s) => s.group);
    expect(groups).toEqual(["Actions", "Go to", "Mandates"]);
  });

  it("limits each group to eight and puts the group with the best match first", () => {
    const sections = paletteSections("firm", ALL);
    expect(sections.map((s) => s.group)).toEqual(["Firms"]);
    expect(sections[0]?.items).toHaveLength(8);
    expect(sections[0]?.items[0]?.id).toBe("f0");
  });

  it("drops groups with no match", () => {
    expect(paletteSections("rul", ALL).map((s) => s.group)).toEqual(["Go to"]);
    expect(paletteSections("zzzz", ALL)).toEqual([]);
  });
});

describe("registerCommands", () => {
  it("adds commands until the returned function is called", () => {
    const first = cmd("p1", "Page action", "Actions");
    const second = cmd("p2", "Other action", "Actions");
    const offFirst = registerCommands([first]);
    const offSecond = registerCommands([second]);
    expect(pageCommands()).toEqual([first, second]);

    offFirst();
    expect(pageCommands()).toEqual([second]);
    offSecond();
    expect(pageCommands()).toEqual([]);
  });
});
