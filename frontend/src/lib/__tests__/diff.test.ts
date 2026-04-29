import { describe, expect, it } from "vitest";
import { lineDiff, fieldDiff } from "../diff";

describe("lineDiff", () => {
  it("identical text → all 'same'", () => {
    const out = lineDiff("a\nb\nc", "a\nb\nc");
    expect(out.oldLines.map(l => l.status)).toEqual(["same", "same", "same"]);
    expect(out.newLines.map(l => l.status)).toEqual(["same", "same", "same"]);
  });

  it("a single line replaced", () => {
    const out = lineDiff("a\nOLD\nc", "a\nNEW\nc");
    expect(out.oldLines.find(l => l.line === "OLD")?.status).toBe("removed");
    expect(out.newLines.find(l => l.line === "NEW")?.status).toBe("added");
  });

  it("appending lines", () => {
    const out = lineDiff("a", "a\nb\nc");
    expect(out.newLines.filter(l => l.status === "added").map(l => l.line))
      .toEqual(["b", "c"]);
  });
});

describe("fieldDiff", () => {
  it("equal objects yield all 'unchanged'", () => {
    const out = fieldDiff({ a: 1, b: "x" }, { a: 1, b: "x" });
    expect(out.every(d => d.status === "unchanged")).toBe(true);
  });

  it("classifies added/removed/changed correctly", () => {
    const out = fieldDiff({ a: 1, b: "x", c: 2 }, { a: 1, b: "y", d: 3 });
    const map = Object.fromEntries(out.map(d => [d.field, d.status]));
    expect(map.a).toBe("unchanged");
    expect(map.b).toBe("changed");
    expect(map.c).toBe("removed");
    expect(map.d).toBe("added");
  });
});
