import { describe, expect, it } from "vitest";
import {
  courseCodesInExpression,
  evaluateExpression,
  parsePrereqExpression,
} from "./prereqExpr";

describe("parsePrereqExpression", () => {
  it("parses a single course", () => {
    expect(parsePrereqExpression("MATH 1550")).toEqual({ course: "MATH 1550" });
  });

  it("parses AND chains", () => {
    expect(parsePrereqExpression("A 1 AND B 2 AND C 3")).toEqual({
      and: [{ course: "A 1" }, { course: "B 2" }, { course: "C 3" }],
    });
  });

  it("gives AND higher precedence than OR", () => {
    expect(parsePrereqExpression("A 1 OR B 2 AND C 3")).toEqual({
      or: [{ course: "A 1" }, { and: [{ course: "B 2" }, { course: "C 3" }] }],
    });
  });

  it("parses parenthesized groups", () => {
    expect(
      parsePrereqExpression("MATH 1550 AND (ENGL 1001 OR ENGL 1004)"),
    ).toEqual({
      and: [
        { course: "MATH 1550" },
        { or: [{ course: "ENGL 1001" }, { course: "ENGL 1004" }] },
      ],
    });
  });

  it("parses the JSON form", () => {
    const json =
      '{"and":[{"course":"MATH 1550"},{"or":[{"course":"ENGL 1001"},{"course":"ENGL 1004"}]}]}';
    expect(parsePrereqExpression(json)).toEqual({
      and: [
        { course: "MATH 1550" },
        { or: [{ course: "ENGL 1001" }, { course: "ENGL 1004" }] },
      ],
    });
  });

  it("is case-insensitive for operators", () => {
    expect(parsePrereqExpression("A 1 and B 2 or C 3")).toEqual({
      or: [{ and: [{ course: "A 1" }, { course: "B 2" }] }, { course: "C 3" }],
    });
  });

  it("rejects empty expressions", () => {
    expect(() => parsePrereqExpression("")).toThrow();
    expect(() => parsePrereqExpression("   ")).toThrow();
  });

  it("rejects unbalanced parentheses", () => {
    expect(() => parsePrereqExpression("(A 1 AND B 2")).toThrow(/parenthesis/);
  });

  it("rejects malformed JSON trees", () => {
    expect(() => parsePrereqExpression('{"and":[]}')).toThrow();
    expect(() => parsePrereqExpression('{"nand":[{"course":"A"}]}')).toThrow();
    expect(() => parsePrereqExpression('{"course":""}')).toThrow();
  });
});

describe("courseCodesInExpression", () => {
  it("collects all leaf codes", () => {
    const expr = parsePrereqExpression("A 1 AND (B 2 OR C 3)");
    expect(courseCodesInExpression(expr).sort()).toEqual(["A 1", "B 2", "C 3"]);
  });
});

describe("evaluateExpression", () => {
  const expr = parsePrereqExpression("A 1 AND (B 2 OR C 3)");
  it("evaluates AND/OR correctly", () => {
    expect(evaluateExpression(expr, new Set(["A 1", "B 2"]))).toBe(true);
    expect(evaluateExpression(expr, new Set(["A 1", "C 3"]))).toBe(true);
    expect(evaluateExpression(expr, new Set(["A 1"]))).toBe(false);
    expect(evaluateExpression(expr, new Set(["B 2", "C 3"]))).toBe(false);
  });
});
