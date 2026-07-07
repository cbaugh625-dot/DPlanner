/**
 * NCAA eligibility engine — pure TypeScript, no framework/DB coupling.
 *
 * Walks a generated plan term-by-term and year-by-year against the ACTIVE
 * eligibility ruleset for the student's division and returns flags.
 *
 * ⚠️ Every threshold comes from the ruleset (data), never from code
 * constants. Checks whose rule is absent from the ruleset are skipped —
 * this is how partially-filled placeholder rulesets (D2/D3/NAIA) behave
 * safely. Results are decision-support only and must be confirmed by the
 * institution's compliance office against the current NCAA manual.
 */
import type {
  EligibilityRuleset,
  PlanFlag,
  PlannedTerm,
} from "../types";
import { termLabel } from "../types";

export interface EligibilityInput {
  terms: PlannedTerm[];
  student: {
    currentCumulativeGpa: number | null;
  };
  institution: {
    minGraduationGpa: number;
  };
  ruleset: EligibilityRuleset;
  /** Degree credits denominator (program total, or combined for double majors). */
  totalCreditsRequired: number;
  /** Raw incoming hours (AP/IB/transfer/etc. — counts toward hour rules). */
  incomingCreditHours: number;
  /** Incoming hours that are degree-applicable (count toward PTD). */
  incomingDegreeCredits: number;
}

export function checkEligibility(input: EligibilityInput): PlanFlag[] {
  const flags: PlanFlag[] = [];
  const { terms, ruleset } = input;
  const rules = ruleset.rules;
  if (terms.length === 0) return flags;

  // ---- Ruleset provenance -------------------------------------------------
  if (!ruleset.verified) {
    flags.push({
      term: null,
      severity: "info",
      ruleKey: "ruleset_unverified",
      message:
        `The ${ruleset.division} eligibility ruleset (effective ${ruleset.effectiveDate}) has NOT been verified by a compliance officer. ` +
        `Treat every result below as provisional. ${ruleset.sourceNote ?? ""}`.trim(),
    });
  }

  const primaryTerms = terms.filter(
    (t) => t.term.type === "fall" || t.term.type === "spring",
  );
  const isPrimary = (t: PlannedTerm) =>
    t.term.type === "fall" || t.term.type === "spring";

  // Academic year of a term: fall Y belongs to AY starting Y; winter/spring/
  // summer of calendar year Y belong to the AY that started in fall Y-1.
  const academicYearStart = (t: PlannedTerm) =>
    t.term.type === "fall" ? t.term.year : t.term.year - 1;
  const firstAY = academicYearStart(terms[0]);
  const yearIndexOf = (t: PlannedTerm) => academicYearStart(t) - firstAY + 1;
  const lastYearIndex = yearIndexOf(terms[terms.length - 1]);

  // Semester ordinal (primary terms only): 1-based.
  const semesterOrdinal = new Map<number, number>(); // termIndex → ordinal
  {
    let n = 0;
    for (const t of terms) {
      if (isPrimary(t)) {
        n++;
        semesterOrdinal.set(t.termIndex, n);
      }
    }
  }

  // ---- Per-term checks ------------------------------------------------------
  for (const t of primaryTerms) {
    if (t.studyAbroad) continue; // credits handled as a block
    if (
      rules.min_credits_per_term_for_next_term !== undefined &&
      t.totalCredits < rules.min_credits_per_term_for_next_term
    ) {
      flags.push({
        term: termLabel(t.term),
        severity: "error",
        ruleKey: "min_term_hours",
        message: `${termLabel(t.term)} has ${t.totalCredits} credit hours — below the ${rules.min_credits_per_term_for_next_term}-hour minimum required to be eligible the following term.`,
      });
    }
    if (
      rules.full_time_min_credits !== undefined &&
      t.totalCredits < rules.full_time_min_credits
    ) {
      flags.push({
        term: termLabel(t.term),
        severity: "error",
        ruleKey: "full_time_enrollment",
        message: `${termLabel(t.term)} has ${t.totalCredits} credit hours — below full-time enrollment (${rules.full_time_min_credits}). A student-athlete must be enrolled full-time to practice or compete.`,
      });
    }
  }

  // ---- Annual hour checks -----------------------------------------------------
  // Group terms by academic year index.
  const byYear = new Map<number, PlannedTerm[]>();
  for (const t of terms) {
    const y = yearIndexOf(t);
    byYear.set(y, [...(byYear.get(y) ?? []), t]);
  }
  const planCompletesInYear = (y: number): boolean => {
    const yearTerms = byYear.get(y) ?? [];
    const last = yearTerms[yearTerms.length - 1];
    return (
      !!last &&
      last.cumulativeDegreePercent >= 100 &&
      y === lastYearIndex
    );
  };
  for (const [y, yearTerms] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const total = yearTerms.reduce((s, t) => s + t.totalCredits, 0);
    const fallSpring = yearTerms
      .filter(isPrimary)
      .reduce((s, t) => s + t.totalCredits, 0);
    const label = `Year ${y}`;
    // Skip annual checks for the final year when the degree completes —
    // the student graduates and no further eligibility is needed.
    if (planCompletesInYear(y)) continue;
    if (rules.annual_hours_required !== undefined && total < rules.annual_hours_required) {
      flags.push({
        term: null,
        severity: "error",
        ruleKey: "annual_hours",
        message: `${label} earns ${total} credit hours — below the ${rules.annual_hours_required}-hour annual requirement.`,
      });
    }
    if (
      rules.annual_hours_fall_spring_only !== undefined &&
      fallSpring < rules.annual_hours_fall_spring_only
    ) {
      flags.push({
        term: null,
        severity: "error",
        ruleKey: "annual_hours_fall_spring",
        message: `${label} earns only ${fallSpring} credit hours in fall+spring — at least ${rules.annual_hours_fall_spring_only} must come from fall and spring (summer hours are excluded from this subset).`,
      });
    }
  }

  // ---- First-year progress (by start of 3rd semester) --------------------------
  if (rules.year1_hours_by_third_semester !== undefined) {
    const thirdSemTerm = [...semesterOrdinal.entries()].find(
      ([, ord]) => ord === 3,
    );
    if (thirdSemTerm) {
      const [thirdIdx] = thirdSemTerm;
      // Hours earned before the 3rd semester (any term type) + incoming hours.
      const earned =
        terms
          .filter((t) => t.termIndex < thirdIdx)
          .reduce((s, t) => s + t.totalCredits, 0) + input.incomingCreditHours;
      if (earned < rules.year1_hours_by_third_semester) {
        const t = terms.find((x) => x.termIndex === thirdIdx)!;
        flags.push({
          term: termLabel(t.term),
          severity: "error",
          ruleKey: "year1_24_hours",
          message: `Only ${earned} credit hours are earned before the third semester (${termLabel(t.term)}) — ${rules.year1_hours_by_third_semester} are required (summer, test and transfer credit may count).`,
        });
      }
    }
  }

  // ---- Percentage-of-degree (40-60-80) -------------------------------------------
  if (rules.ptd_percent_by_year && input.totalCreditsRequired > 0) {
    for (const [yearStr, pct] of Object.entries(rules.ptd_percent_by_year)) {
      const year = parseInt(yearStr, 10);
      if (year > lastYearIndex) continue; // plan ends before this checkpoint
      // Status at the START of `year` = cumulative after all terms of earlier years.
      const before = terms.filter((t) => yearIndexOf(t) < year);
      const cumulative =
        before.length > 0
          ? before[before.length - 1].cumulativeDegreeCredits
          : input.incomingDegreeCredits;
      const percent = (cumulative / input.totalCreditsRequired) * 100;
      if (percent < pct) {
        const checkpointTerm = terms.find((t) => yearIndexOf(t) === year);
        flags.push({
          term: checkpointTerm ? termLabel(checkpointTerm.term) : null,
          severity: "error",
          ruleKey: `ptd_${pct}_percent`,
          message: `Entering year ${year}, the plan completes ${Math.floor(percent)}% of degree-applicable requirements (${cumulative}/${input.totalCreditsRequired} hours) — the progress-toward-degree rule requires ${pct}%.`,
        });
      }
    }
  }

  // ---- Major declaration & degree-applicability ------------------------------------
  if (rules.declare_major_by_semester !== undefined) {
    flags.push({
      term: null,
      severity: "info",
      ruleKey: "declare_major",
      message: `The major must be formally declared by semester ${rules.declare_major_by_semester}. This plan assumes the program shown is (or will be) the declared major.`,
    });
  }
  if (rules.degree_applicable_only_from_semester !== undefined) {
    for (const t of terms) {
      const ord = semesterOrdinal.get(t.termIndex);
      if (!ord || ord < rules.degree_applicable_only_from_semester) continue;
      const prev = terms.filter((x) => x.termIndex < t.termIndex);
      const prevCum =
        prev.length > 0
          ? prev[prev.length - 1].cumulativeDegreeCredits
          : input.incomingDegreeCredits;
      const applicable = t.cumulativeDegreeCredits - prevCum;
      const nonApplicable = t.totalCredits - applicable;
      if (nonApplicable > 0) {
        flags.push({
          term: termLabel(t.term),
          severity: "warning",
          ruleKey: "non_degree_applicable_credits",
          message: `${termLabel(t.term)} (semester ${ord}) includes ${nonApplicable} credit hour(s) that do not apply to the declared degree. From semester ${rules.degree_applicable_only_from_semester} onward, only degree-applicable hours count toward progress-toward-degree.`,
        });
      }
    }
  }

  // ---- GPA thresholds -----------------------------------------------------------
  if (
    rules.gpa_percent_of_grad_min_by_year &&
    input.student.currentCumulativeGpa !== null
  ) {
    const gpa = input.student.currentCumulativeGpa;
    for (const [yearStr, pct] of Object.entries(
      rules.gpa_percent_of_grad_min_by_year,
    )) {
      const year = parseInt(yearStr, 10);
      if (year > lastYearIndex) continue;
      const required =
        Math.round(input.institution.minGraduationGpa * (pct / 100) * 100) / 100;
      if (gpa < required) {
        flags.push({
          term: null,
          severity: "error",
          ruleKey: `gpa_year_${year}`,
          message: `Cumulative GPA ${gpa.toFixed(2)} is below ${required.toFixed(2)} (${pct}% of the ${input.institution.minGraduationGpa.toFixed(2)} graduation minimum) required entering year ${year}. The student must raise their GPA before that checkpoint.`,
        });
        break; // one GPA flag at the earliest failing checkpoint is enough
      }
    }
  }

  // ---- Eligibility clock ------------------------------------------------------------
  if (rules.eligibility_clock_years !== undefined) {
    const yearsUsed = lastYearIndex;
    if (yearsUsed > rules.eligibility_clock_years) {
      flags.push({
        term: null,
        severity: "error",
        ruleKey: "eligibility_clock",
        message: `The plan spans ${yearsUsed} academic years — beyond the ${rules.eligibility_clock_years}-year eligibility clock. Terms after the clock expires cannot include competition.`,
      });
    } else if (yearsUsed === rules.eligibility_clock_years) {
      flags.push({
        term: null,
        severity: "warning",
        ruleKey: "eligibility_clock",
        message: `The plan uses the full ${rules.eligibility_clock_years}-year eligibility clock with no slack for redshirt or medical years.`,
      });
    }
  }

  return flags;
}

/** Sort: errors → warnings → info, then by term order. */
export function sortFlags(flags: PlanFlag[]): PlanFlag[] {
  const sevRank = { error: 0, warning: 1, info: 2 };
  return [...flags].sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      (a.term ?? "").localeCompare(b.term ?? ""),
  );
}
