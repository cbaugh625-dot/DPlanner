/**
 * Athletic-load advisories: informational checks of a plan against the
 * sport's calendar. These are advising signals, not NCAA rules (those live
 * in /lib/eligibility).
 *
 * v1 works at term granularity: it displays practice/travel blocks and warns
 * when an in-season term is overloaded. Time-of-day class-vs-practice
 * conflict resolution against live section schedules is deliberately a later
 * phase (requires section-level data the import template doesn't cover yet).
 */
import type {
  AthleticCalendar,
  Course,
  PlanFlag,
  PlannedTerm,
} from "../types";
import { termLabel } from "../types";

export interface AthleticCheckOptions {
  /** Credit load above which an in-season term is considered overloaded. */
  inSeasonMaxCredits?: number;
  /** Difficulty at or above which a course counts as "highest difficulty". */
  hardDifficulty?: number;
}

export function checkAthleticLoad(
  terms: PlannedTerm[],
  calendar: AthleticCalendar | null | undefined,
  courseMap: ReadonlyMap<string, Course>,
  options: AthleticCheckOptions = {},
): PlanFlag[] {
  if (!calendar) return [];
  const inSeasonMax = options.inSeasonMaxCredits ?? 13;
  const hardDifficulty = options.hardDifficulty ?? 5;
  const championship = new Set(calendar.championshipTerms);
  const flags: PlanFlag[] = [];

  const practiceSummary =
    calendar.practiceBlocks.length > 0
      ? ` In season, ${calendar.sport} practices ${calendar.practiceBlocks
          .map((b) => `${b.days.join("/")} ${b.start}–${b.end}`)
          .join(" and ")}.`
      : "";

  for (const t of terms) {
    if (!championship.has(t.term.type)) continue;
    if (t.totalCredits > inSeasonMax) {
      flags.push({
        term: termLabel(t.term),
        severity: "warning",
        ruleKey: "in_season_overload",
        message: `${termLabel(t.term)} carries ${t.totalCredits} credits during the ${calendar.sport} championship season (recommended in-season maximum: ${inSeasonMax}).${practiceSummary} Consider the "Lighter in-season load" strategy.`,
      });
    }
    const hardCourses = t.courseIds
      .map((id) => courseMap.get(id))
      .filter((c): c is Course => !!c && (c.difficulty ?? 0) >= hardDifficulty);
    if (hardCourses.length > 0) {
      flags.push({
        term: termLabel(t.term),
        severity: "info",
        ruleKey: "hard_course_in_season",
        message: `${termLabel(t.term)} schedules ${hardCourses
          .map((c) => c.code)
          .join(", ")} (difficulty ${hardDifficulty}/5) during the ${calendar.sport} season. If workload is a concern, move to an off-season term.`,
      });
    }
  }
  return flags;
}
