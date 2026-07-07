import type { Course, GradTarget, Term, TermType } from "../types";
import { TERM_ORDER_IN_ACADEMIC_YEAR } from "../types";

/** Number of primary (fall/spring) terms for each graduation target. */
export const TARGET_PRIMARY_TERMS: Record<GradTarget, number> = {
  grad_3yr: 6,
  grad_3_5yr: 7,
  grad_4yr: 8,
  grad_4_5yr: 9,
  grad_5yr: 10,
};

export const PRIMARY_TERM_TYPES: TermType[] = ["fall", "spring"];

export function isPrimaryTerm(t: Term): boolean {
  return PRIMARY_TERM_TYPES.includes(t.type);
}

/** The next term chronologically, cycling fall → winter → spring → summer. */
export function nextTerm(t: Term): Term {
  const idx = TERM_ORDER_IN_ACADEMIC_YEAR.indexOf(t.type);
  const nextType =
    TERM_ORDER_IN_ACADEMIC_YEAR[(idx + 1) % TERM_ORDER_IN_ACADEMIC_YEAR.length];
  // Academic year rolls: fall Y → winter Y+1 → spring Y+1 → summer Y+1 → fall Y+1
  const year = t.type === "fall" ? t.year + 1 : nextType === "fall" ? t.year : t.year;
  return { type: nextType, year };
}

/**
 * Build the chronological sequence of schedulable terms starting at `start`,
 * containing exactly `primaryCount` primary (fall/spring) terms, with any
 * configured optional terms (summer/winter) interleaved. Trailing optional
 * terms after the last primary term are excluded.
 */
export function buildTermSequence(
  start: Term,
  primaryCount: number,
  availableTermTypes: ReadonlySet<TermType>,
): Term[] {
  const seq: Term[] = [];
  let t = { ...start };
  let primaries = 0;
  let guard = 0;
  while (primaries < primaryCount && guard++ < 100) {
    if (availableTermTypes.has(t.type)) {
      if (isPrimaryTerm(t)) {
        seq.push({ ...t });
        primaries++;
      } else if (primaries > 0) {
        // Optional terms only make sense once the plan has started.
        seq.push({ ...t });
      }
    }
    t = nextTerm(t);
  }
  return seq;
}

/**
 * Is the course offered in this concrete term, respecting both the term-type
 * flags and the alternate-year cadence (odd/even refers to the calendar year
 * in which the term occurs)?
 */
export function isOfferedInTerm(course: Course, term: Term): boolean {
  const o = course.offering;
  const typeOffered =
    (term.type === "fall" && o.fall) ||
    (term.type === "spring" && o.spring) ||
    (term.type === "summer" && o.summer) ||
    (term.type === "winter" && o.winter);
  if (!typeOffered) return false;
  if (o.cadence === "every_year") return true;
  const isOdd = term.year % 2 === 1;
  return o.cadence === "alternate_years_odd" ? isOdd : !isOdd;
}
