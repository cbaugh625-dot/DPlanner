import type { PrereqExpr } from "../types";

/**
 * Prerequisite expressions are accepted in two equivalent forms:
 *
 * 1. JSON boolean tree (detected by a leading "{"):
 *    {"and":[{"course":"MATH 1550"},{"or":[{"course":"ENGL 1001"},{"course":"ENGL 1004"}]}]}
 *
 * 2. Compact infix syntax:
 *    MATH 1550 AND (ENGL 1001 OR ENGL 1004)
 *    - Course codes are anything that isn't AND/OR/parens (whitespace trimmed).
 *    - AND binds tighter than OR; parentheses group.
 */
export function parsePrereqExpression(input: string): PrereqExpr {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    validateExprShape(parsed);
    return parsed as PrereqExpr;
  }
  return new InfixParser(trimmed).parse();
}

export function validateExprShape(node: unknown): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new Error("expression node must be an object");
  }
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new Error(
      `expression node must have exactly one of "course" | "and" | "or" (got: ${keys.join(", ") || "none"})`,
    );
  }
  const key = keys[0];
  if (key === "course") {
    if (typeof obj.course !== "string" || obj.course.trim() === "") {
      throw new Error(`"course" must be a non-empty string`);
    }
  } else if (key === "and" || key === "or") {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`"${key}" must be a non-empty array`);
    }
    arr.forEach(validateExprShape);
  } else {
    throw new Error(`unknown expression key "${key}"`);
  }
}

/** All course codes referenced anywhere in the expression. */
export function courseCodesInExpression(expr: PrereqExpr): string[] {
  if ("course" in expr) return [expr.course];
  const children = "and" in expr ? expr.and : expr.or;
  return children.flatMap(courseCodesInExpression);
}

/** Evaluate the expression given a set of satisfied course codes. */
export function evaluateExpression(
  expr: PrereqExpr,
  satisfied: ReadonlySet<string>,
): boolean {
  if ("course" in expr) return satisfied.has(expr.course);
  if ("and" in expr) return expr.and.every((e) => evaluateExpression(e, satisfied));
  return expr.or.some((e) => evaluateExpression(e, satisfied));
}

// ---------------------------------------------------------------------------

type Token =
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "and" }
  | { kind: "or" }
  | { kind: "course"; code: string };

class InfixParser {
  private tokens: Token[];
  private pos = 0;

  constructor(input: string) {
    this.tokens = tokenize(input);
    if (this.tokens.length === 0) {
      throw new Error("empty prerequisite expression");
    }
  }

  parse(): PrereqExpr {
    const expr = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error("unexpected trailing tokens in expression");
    }
    return expr;
  }

  private parseOr(): PrereqExpr {
    const parts: PrereqExpr[] = [this.parseAnd()];
    while (this.peek()?.kind === "or") {
      this.pos++;
      parts.push(this.parseAnd());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  }

  private parseAnd(): PrereqExpr {
    const parts: PrereqExpr[] = [this.parseAtom()];
    while (this.peek()?.kind === "and") {
      this.pos++;
      parts.push(this.parseAtom());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  }

  private parseAtom(): PrereqExpr {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error("unexpected end of expression");
    if (tok.kind === "lparen") {
      this.pos++;
      const inner = this.parseOr();
      const close = this.tokens[this.pos];
      if (!close || close.kind !== "rparen") {
        throw new Error("missing closing parenthesis");
      }
      this.pos++;
      return inner;
    }
    if (tok.kind === "course") {
      this.pos++;
      return { course: tok.code };
    }
    throw new Error(`unexpected token "${tok.kind}" in expression`);
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  // Split on parens, keeping them; then split remaining chunks on
  // word-boundary AND/OR (case-insensitive).
  const chunks = input.split(/([()])/);
  for (const chunk of chunks) {
    if (chunk === "(") {
      tokens.push({ kind: "lparen" });
    } else if (chunk === ")") {
      tokens.push({ kind: "rparen" });
    } else {
      const parts = chunk.split(/\b(AND|OR)\b/i);
      for (const part of parts) {
        const p = part.trim();
        if (p === "") continue;
        if (/^and$/i.test(p)) tokens.push({ kind: "and" });
        else if (/^or$/i.test(p)) tokens.push({ kind: "or" });
        else tokens.push({ kind: "course", code: p });
      }
    }
  }
  return tokens;
}
