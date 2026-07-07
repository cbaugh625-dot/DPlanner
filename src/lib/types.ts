/**
 * Pure domain types shared by the scheduler, eligibility engine, and importer.
 * No framework or DB coupling — DB rows are mapped into these shapes.
 */

export type Division = "D1" | "D2" | "D3" | "NAIA";

export type TermType = "fall" | "spring" | "summer" | "winter";

/** Ordered within an academic year: fall → winter → spring → summer. */
export const TERM_ORDER_IN_ACADEMIC_YEAR: TermType[] = [
  "fall",
  "winter",
  "spring",
  "summer",
];

export type Cadence =
  | "every_year"
  | "alternate_years_odd"
  | "alternate_years_even";

export type RequirementRuleType =
  | "all_of"
  | "choose_n_courses"
  | "choose_n_credits";

export type ProgramType = "major" | "minor";

export type GradTarget =
  | "grad_3yr"
  | "grad_3_5yr"
  | "grad_4yr"
  | "grad_4_5yr"
  | "grad_5yr";

export type Strategy =
  | "balanced"
  | "front_load_hard"
  | "light_in_season"
  | "summer_accelerated";

export type FlagSeverity = "error" | "warning" | "info";

export type IncomingCreditSource =
  | "AP"
  | "IB"
  | "dual_enrollment"
  | "transfer"
  | "clep";

export type PtdDenominator = "primary_only" | "combined";

// ---------------------------------------------------------------------------
// Prerequisite expression tree
// ---------------------------------------------------------------------------

/**
 * Boolean tree over course codes:
 * {"and":[{"course":"MATH 1550"},{"or":[{"course":"ENGL 1001"},{"course":"ENGL 1004"}]}]}
 */
export type PrereqExpr =
  | { course: string }
  | { and: PrereqExpr[] }
  | { or: PrereqExpr[] };

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface TermConfig {
  termType: TermType;
  minCredits: number;
  maxCredits: number;
  /** null for optional terms (summer/winter) with no full-time expectation */
  fullTimeThreshold: number | null;
}

export interface Institution {
  id: string;
  slug: string;
  name: string;
  division: Division;
  minGraduationGpa: number;
  defaultDegreeCredits: number;
  terms: TermConfig[];
}

export interface Course {
  id: string;
  code: string;
  title: string;
  credits: number;
  description?: string | null;
  /** 1 (easy) – 5 (hard) */
  difficulty?: number | null;
  offering: {
    fall: boolean;
    spring: boolean;
    summer: boolean;
    winter: boolean;
    cadence: Cadence;
  };
  prerequisites: CoursePrereq[];
}

export interface CoursePrereq {
  type: "prerequisite" | "corequisite";
  expression: PrereqExpr;
  minGrade?: string | null;
}

export interface RequirementCategory {
  id: string;
  slug: string;
  name: string;
  creditsRequired: number;
  ruleType: RequirementRuleType;
  ruleValue: number | null;
  /** Course IDs that can satisfy this category. */
  courseIds: string[];
  sortOrder: number;
}

export interface Program {
  id: string;
  slug: string;
  name: string;
  degreeType: string;
  catalogYear: string;
  totalCreditsRequired: number;
  type: ProgramType;
  categories: RequirementCategory[];
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export interface IncomingCredit {
  source: IncomingCreditSource;
  satisfiesCourseId?: string | null;
  satisfiesRequirementCategoryId?: string | null;
  credits: number;
  grade?: string | null;
}

export interface Student {
  id: string;
  displayName: string;
  sport: string;
  division: Division;
  /** e.g. "Fall 2025" */
  enrollmentStartTerm: string;
  currentCumulativeGpa: number | null;
  incomingCredits: IncomingCredit[];
}

// ---------------------------------------------------------------------------
// Athletics
// ---------------------------------------------------------------------------

export interface PracticeBlock {
  days: string[]; // e.g. ["Mon", "Wed", "Fri"]
  start: string; // "06:00"
  end: string; // "09:00"
  label?: string;
}

export interface AthleticCalendar {
  sport: string;
  /** Term types containing the championship (competition) season. */
  championshipTerms: TermType[];
  inSeasonWeeks: { start: string; end: string; label?: string }[];
  practiceBlocks: PracticeBlock[];
  typicalTravelPattern: {
    description?: string;
    daysPerWeekInSeason?: number;
  };
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** A concrete academic term, e.g. { type: "fall", year: 2025 } → "Fall 2025". */
export interface Term {
  type: TermType;
  /** Calendar year in which the term starts. */
  year: number;
}

export function termLabel(t: Term): string {
  const name = t.type.charAt(0).toUpperCase() + t.type.slice(1);
  return `${name} ${t.year}`;
}

export function parseTermLabel(label: string): Term {
  const m = label.trim().match(/^(fall|spring|summer|winter)\s+(\d{4})$/i);
  if (!m) throw new Error(`Unparseable term label: "${label}"`);
  return { type: m[1].toLowerCase() as TermType, year: parseInt(m[2], 10) };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlannedTerm {
  term: Term;
  termIndex: number; // 1-based
  courseIds: string[];
  totalCredits: number;
  cumulativeDegreeCredits: number;
  cumulativeDegreePercent: number;
  /** True when the student's sport is in championship season this term. */
  inSeason?: boolean;
  /** Study-abroad placeholder term (generic credit block, no specific courses). */
  studyAbroad?: boolean;
}

export interface PlanFlag {
  term?: string | null; // term label; null for annual/cumulative flags
  severity: FlagSeverity;
  ruleKey: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Eligibility ruleset (data-driven; see eligibility engine)
// ---------------------------------------------------------------------------

export interface EligibilityRules {
  min_credits_per_term_for_next_term?: number;
  full_time_min_credits?: number;
  annual_hours_required?: number;
  annual_hours_fall_spring_only?: number;
  year1_hours_by_third_semester?: number;
  ptd_percent_by_year?: Record<string, number>;
  declare_major_by_semester?: number;
  degree_applicable_only_from_semester?: number;
  gpa_percent_of_grad_min_by_year?: Record<string, number>;
  eligibility_clock_years?: number;
  seasons_of_competition?: number;
}

export interface EligibilityRuleset {
  id: string;
  division: Division;
  effectiveDate: string; // ISO date
  rules: EligibilityRules;
  sourceNote?: string | null;
  verified: boolean;
}
