import type {
  AthleticCalendar,
  Course,
  GradTarget,
  Institution,
  PlannedTerm,
  PrereqExpr,
  Program,
  Strategy,
  Student,
  Term,
  TermType,
} from "../types";
import { termLabel, parseTermLabel } from "../types";
import { evaluateExpression } from "../importer/prereqExpr";
import {
  buildTermSequence,
  isOfferedInTerm,
  isPrimaryTerm,
  TARGET_PRIMARY_TERMS,
} from "./terms";
import {
  resolveRequirements,
  type CategoryAssignment,
  type ResolvedRequirements,
} from "./requirements";

export interface ScheduleRequest {
  institution: Institution;
  /** Primary major (with categories + courseIds). */
  program: Program;
  /** Optional second major. */
  secondaryProgram?: Program | null;
  /** Optional minors. */
  minors?: Program[];
  /** Full course catalog for the institution. */
  courses: Course[];
  student: Student;
  target: GradTarget;
  strategy: Strategy;
  athleticCalendar?: AthleticCalendar | null;
  options?: {
    /** Credit cap for championship-season terms under light_in_season. */
    inSeasonMaxCredits?: number;
    /** PTD denominator mode for double majors. */
    ptdDenominator?: "primary_only" | "combined";
    /** Term labels (e.g. "Fall 2027") to reserve for study abroad. */
    studyAbroadTerms?: string[];
    /** Credits assumed earned in each study-abroad term. */
    studyAbroadCredits?: number;
  };
}

export interface ScheduleResult {
  /** True when the plan satisfies every requirement within the requested target. */
  feasible: boolean;
  /** Present when the requested target could not be met (closest plan returned). */
  explanation: string | null;
  terms: PlannedTerm[];
  /** Courses that could not be placed anywhere (only when even the fallback failed). */
  unscheduledCourseIds: string[];
  /** courseId → category assignments used for degree-progress accounting. */
  assignments: Record<string, CategoryAssignment[]>;
  /** Denominator used for degree-percent / PTD. */
  totalCreditsRequired: number;
  /** Degree-applicable credits granted before term 1 (incoming credit). */
  incomingDegreeCredits: number;
  requestedPrimaryTerms: number;
  deliveredPrimaryTerms: number;
  /** Data errors (unsatisfiable pools, prerequisite cycles). */
  dataErrors: string[];
}

const DEFAULT_IN_SEASON_MAX = 13;

export function generatePlan(req: ScheduleRequest): ScheduleResult {
  const courseMap = new Map(req.courses.map((c) => [c.id, c]));
  const codeToId = new Map(req.courses.map((c) => [c.code, c.id]));

  const programsToSatisfy: Program[] = [
    req.program,
    ...(req.secondaryProgram ? [req.secondaryProgram] : []),
    ...(req.minors ?? []),
  ];

  const resolved = resolveRequirements(
    programsToSatisfy,
    courseMap,
    req.student.incomingCredits,
  );

  // --- Prerequisite cycle detection (data error) ----------------------------
  const cycle = findPrereqCycle(resolved.toSchedule, courseMap, codeToId);
  const dataErrors = [...resolved.errors];
  if (cycle) {
    dataErrors.push(
      `Prerequisite cycle detected: ${cycle.map((id) => courseMap.get(id)?.code ?? id).join(" → ")}. Fix the catalog data.`,
    );
  }
  if (dataErrors.length > 0 && (cycle || resolved.toSchedule.length === 0)) {
    return emptyResult(req, resolved, dataErrors);
  }

  const startTerm = parseTermLabel(req.student.enrollmentStartTerm);
  const requestedPrimary = TARGET_PRIMARY_TERMS[req.target];
  const availableTermTypes = new Set<TermType>(
    req.institution.terms.map((t) => t.termType),
  );

  // Attempt ladder: requested target → summer rescue → extend up to +4
  // primary terms. First fully-scheduled attempt wins; otherwise keep the
  // best (fewest unscheduled courses).
  type Attempt = ReturnType<typeof assignToTerms> & {
    primary: number;
    summerRescue: boolean;
  };
  let best: Attempt | null = null;
  const maxExtension = 4;
  outer: for (let ext = 0; ext <= maxExtension; ext++) {
    for (const summerRescue of ext === 0 ? [false, true] : [true]) {
      const seq = buildTermSequence(
        startTerm,
        requestedPrimary + ext,
        availableTermTypes,
      );
      const attempt = {
        ...assignToTerms(req, resolved, courseMap, codeToId, seq, summerRescue),
        primary: requestedPrimary + ext,
        summerRescue,
      };
      if (
        !best ||
        attempt.unscheduled.length < best.unscheduled.length ||
        (attempt.unscheduled.length === best.unscheduled.length &&
          attempt.primary < best.primary)
      ) {
        best = attempt;
      }
      if (attempt.unscheduled.length === 0) break outer;
    }
  }
  const chosen = best!;

  // --- Rollups ---------------------------------------------------------------
  const { denominator, countedCategories, categoryCaps } = degreeAccounting(
    req,
    programsToSatisfy,
  );

  const appliedPerCategory = new Map<string, number>();
  let incomingDegreeCredits = 0;
  const applyToCategories = (
    courseAssignments: CategoryAssignment[] | undefined,
    credits: number,
  ): number => {
    if (!courseAssignments) return 0;
    let contributed = 0;
    for (const a of courseAssignments) {
      if (!countedCategories.has(a.categoryId)) continue;
      const cap = categoryCaps.get(a.categoryId) ?? 0;
      const applied = appliedPerCategory.get(a.categoryId) ?? 0;
      const room = Math.max(0, cap - applied);
      const contribution = Math.min(credits, room);
      appliedPerCategory.set(a.categoryId, applied + contribution);
      contributed += contribution;
    }
    return contributed;
  };
  // Incoming course credit
  for (const [courseId, assigns] of resolved.satisfiedByIncoming) {
    incomingDegreeCredits += applyToCategories(
      assigns,
      courseMap.get(courseId)?.credits ?? 0,
    );
  }
  // Incoming category-level credit
  for (const [categoryId, credits] of resolved.categoryIncomingCredits) {
    incomingDegreeCredits += applyToCategories(
      [{ programId: "", categoryId }],
      credits,
    );
  }

  const championshipTerms = new Set(
    req.athleticCalendar?.championshipTerms ?? [],
  );
  let cumulative = incomingDegreeCredits;
  const plannedTerms: PlannedTerm[] = [];
  chosen.terms.forEach((draft, i) => {
    const totalCredits = draft.courseIds.reduce(
      (sum, id) => sum + (courseMap.get(id)?.credits ?? 0),
      0,
    );
    for (const id of draft.courseIds) {
      cumulative += applyToCategories(
        resolved.assignments.get(id),
        courseMap.get(id)?.credits ?? 0,
      );
    }
    plannedTerms.push({
      term: draft.term,
      termIndex: i + 1,
      courseIds: draft.courseIds,
      totalCredits,
      cumulativeDegreeCredits: cumulative,
      cumulativeDegreePercent:
        denominator > 0
          ? Math.min(100, Math.round((cumulative / denominator) * 10000) / 100)
          : 0,
      inSeason: championshipTerms.has(draft.term.type),
    });
  });

  // Drop trailing empty terms (plan completes early); drop empty optional terms.
  const trimmed = plannedTerms.filter(
    (t, i) =>
      t.courseIds.length > 0 ||
      (isPrimaryTerm(t.term) &&
        plannedTerms.slice(i + 1).some((later) => later.courseIds.length > 0)),
  );
  trimmed.forEach((t, i) => (t.termIndex = i + 1));

  const feasible =
    chosen.unscheduled.length === 0 && chosen.primary <= requestedPrimary;
  let explanation: string | null = null;
  if (!feasible) {
    explanation = buildExplanation(
      req,
      chosen.unscheduled,
      chosen.primary,
      requestedPrimary,
      courseMap,
      codeToId,
      resolved,
    );
  }

  return {
    feasible,
    explanation,
    terms: trimmed,
    unscheduledCourseIds: chosen.unscheduled,
    assignments: Object.fromEntries(resolved.assignments),
    totalCreditsRequired: denominator,
    incomingDegreeCredits,
    requestedPrimaryTerms: requestedPrimary,
    deliveredPrimaryTerms: trimmed.filter((t) => isPrimaryTerm(t.term)).length,
    dataErrors,
  };
}

// ---------------------------------------------------------------------------
// Term assignment (greedy with criticality ordering + capacity eviction)
// ---------------------------------------------------------------------------

interface TermDraft {
  term: Term;
  courseIds: string[];
}

function assignToTerms(
  req: ScheduleRequest,
  resolved: ResolvedRequirements,
  courseMap: ReadonlyMap<string, Course>,
  codeToId: ReadonlyMap<string, string>,
  seq: Term[],
  summerRescue: boolean,
): { terms: TermDraft[]; unscheduled: string[] } {
  const termCfg = new Map(req.institution.terms.map((t) => [t.termType, t]));
  const championship = new Set(req.athleticCalendar?.championshipTerms ?? []);
  const inSeasonMax = req.options?.inSeasonMaxCredits ?? DEFAULT_IN_SEASON_MAX;

  // Criticality: height of the dependent chain above each course.
  const height = computeHeights(resolved.toSchedule, courseMap, codeToId);

  // Category rule types for "core first" ordering.
  const allOfCategoryIds = new Set<string>();
  for (const p of [req.program, req.secondaryProgram, ...(req.minors ?? [])]) {
    if (!p) continue;
    for (const c of p.categories) {
      if (c.ruleType === "all_of") allOfCategoryIds.add(c.id);
    }
  }
  const isCore = (courseId: string) =>
    (resolved.assignments.get(courseId) ?? []).some((a) =>
      allOfCategoryIds.has(a.categoryId),
    );

  const completedCodes = new Set<string>(); // course codes passed in earlier terms
  for (const id of resolved.satisfiedByIncoming.keys()) {
    completedCodes.add(courseMap.get(id)!.code);
  }
  const unscheduled = new Set(resolved.toSchedule);
  const drafts: TermDraft[] = [];

  const remainingCredits = () =>
    [...unscheduled].reduce((s, id) => s + (courseMap.get(id)?.credits ?? 0), 0);

  for (let i = 0; i < seq.length; i++) {
    const term = seq[i];
    const cfg = termCfg.get(term.type);
    if (!cfg) continue;
    const primary = isPrimaryTerm(term);
    const remainingPrimaries = seq
      .slice(i)
      .filter((t) => isPrimaryTerm(t)).length;
    const inSeason = championship.has(term.type);

    const target = termTarget(
      req.strategy,
      primary,
      inSeason,
      remainingCredits(),
      remainingPrimaries,
      cfg.minCredits,
      cfg.maxCredits,
      cfg.fullTimeThreshold,
      inSeasonMax,
      summerRescue,
    );
    // In-season terms under light_in_season have a HARD credit cap, not just
    // a soft fill target.
    const hardCap =
      req.strategy === "light_in_season" && inSeason && primary
        ? Math.min(inSeasonMax, cfg.maxCredits)
        : cfg.maxCredits;

    const picked: string[] = [];
    let total = 0;
    if (target > 0) {
      // Candidate pool: eligible this term.
      const strategyKey = (id: string): number => {
        const d = courseMap.get(id)?.difficulty ?? 3;
        if (req.strategy === "front_load_hard") return -d; // hard first
        if (req.strategy === "light_in_season" && inSeason) return d; // easy first
        return 0;
      };
      // How many chances remain AFTER this term to take the course within
      // the plan window? Rare offerings (fall-only, alternate-year) must not
      // be deferred past their last chance.
      const futureOfferings = (id: string): number => {
        const c = courseMap.get(id)!;
        return seq.slice(i + 1).filter((t) => isOfferedInTerm(c, t)).length;
      };
      const eligible = [...unscheduled]
        .filter((id) => {
          const c = courseMap.get(id)!;
          return (
            isOfferedInTerm(c, term) &&
            prereqsSatisfied(c, completedCodes, codeToId)
          );
        })
        .sort((x, y) => {
          const ux = Math.min(futureOfferings(x), 3);
          const uy = Math.min(futureOfferings(y), 3);
          if (ux !== uy) return ux - uy; // scarce offerings first
          const hx = height.get(x) ?? 0;
          const hy = height.get(y) ?? 0;
          if (hx !== hy) return hy - hx; // critical chains first
          const cx = isCore(x) ? 0 : 1;
          const cy = isCore(y) ? 0 : 1;
          if (cx !== cy) return cx - cy; // required cores before electives
          const sx = strategyKey(x);
          const sy = strategyKey(y);
          if (sx !== sy) return sx - sy;
          return courseMap.get(x)!.code.localeCompare(courseMap.get(y)!.code);
        });

      const pickedSet = new Set<string>();
      for (const id of eligible) {
        // A course with no future offering in the window must be taken now,
        // even past the soft fill target (hard cap still applies).
        const mustTakeNow = futureOfferings(id) === 0;
        if (total >= target && !mustTakeNow) continue;
        if (pickedSet.has(id)) continue;
        const course = courseMap.get(id)!;
        // Corequisites: must be satisfied by completed ∪ this term's picks;
        // pull unsatisfied coreq partners into the same term when possible.
        const group = [id];
        let groupCredits = course.credits;
        let groupOk = true;
        for (const p of course.prerequisites) {
          if (p.type !== "corequisite") continue;
          const inTermCodes = new Set([
            ...completedCodes,
            ...[...pickedSet, ...group].map((g) => courseMap.get(g)!.code),
          ]);
          if (evaluateExpression(p.expression, inTermCodes)) continue;
          // Try to pull a single unscheduled coreq course that satisfies it.
          const partner = [...unscheduled].find((pid) => {
            if (pickedSet.has(pid) || group.includes(pid)) return false;
            const pc = courseMap.get(pid)!;
            if (!isOfferedInTerm(pc, term)) return false;
            if (!prereqsSatisfied(pc, completedCodes, codeToId)) return false;
            const withPartner = new Set([...inTermCodes, pc.code]);
            return evaluateExpression(p.expression, withPartner);
          });
          if (partner) {
            group.push(partner);
            groupCredits += courseMap.get(partner)!.credits;
          } else {
            groupOk = false;
            break;
          }
        }
        if (!groupOk) continue;
        if (total + groupCredits > hardCap) continue;
        for (const g of group) {
          pickedSet.add(g);
          total += courseMap.get(g)!.credits;
        }
      }
      picked.push(...pickedSet);
    }

    for (const id of picked) unscheduled.delete(id);
    drafts.push({ term, courseIds: picked });
    for (const id of picked) completedCodes.add(courseMap.get(id)!.code);
  }

  return { terms: drafts, unscheduled: [...unscheduled] };
}

function termTarget(
  strategy: Strategy,
  primary: boolean,
  inSeason: boolean,
  remaining: number,
  remainingPrimaries: number,
  minCredits: number,
  maxCredits: number,
  fullTimeThreshold: number | null,
  inSeasonMax: number,
  summerRescue: boolean,
): number {
  const ft = fullTimeThreshold ?? minCredits;
  if (!primary) {
    // Optional term (summer/winter)
    if (strategy === "summer_accelerated") return maxCredits;
    if (summerRescue) return maxCredits;
    if (strategy === "light_in_season") {
      // Use summer as overflow only when the primary terms alone are tight.
      return remaining > ft * remainingPrimaries + 6 ? maxCredits : 0;
    }
    return 0;
  }
  const even = Math.ceil(remaining / Math.max(1, remainingPrimaries));
  const clamp = (v: number) => Math.max(ft, Math.min(maxCredits, v));
  switch (strategy) {
    case "balanced":
    case "summer_accelerated":
      return clamp(even);
    case "front_load_hard":
      return clamp(even + 3);
    case "light_in_season":
      return inSeason ? Math.min(inSeasonMax, maxCredits) : clamp(even + 2);
  }
}

function prereqsSatisfied(
  course: Course,
  completedCodes: ReadonlySet<string>,
  codeToId: ReadonlyMap<string, string>,
): boolean {
  void codeToId;
  for (const p of course.prerequisites) {
    if (p.type !== "prerequisite") continue;
    if (!evaluateExpression(p.expression, completedCodes)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------

/** Height of each course in the dependency graph restricted to `selected`. */
function computeHeights(
  selected: string[],
  courseMap: ReadonlyMap<string, Course>,
  codeToId: ReadonlyMap<string, string>,
): Map<string, number> {
  const selectedSet = new Set(selected);
  // edges: prereq → dependents
  const dependents = new Map<string, string[]>();
  for (const id of selected) {
    const c = courseMap.get(id)!;
    for (const p of c.prerequisites) {
      for (const code of exprLeaves(p.expression)) {
        const pid = codeToId.get(code);
        if (pid && selectedSet.has(pid)) {
          const list = dependents.get(pid) ?? [];
          list.push(id);
          dependents.set(pid, list);
        }
      }
    }
  }
  const height = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (height.has(id)) return height.get(id)!;
    if (stack.has(id)) return 0; // cycle handled elsewhere
    stack.add(id);
    let h = 0;
    for (const d of dependents.get(id) ?? []) {
      h = Math.max(h, 1 + visit(d, stack));
    }
    stack.delete(id);
    height.set(id, h);
    return h;
  };
  for (const id of selected) visit(id, new Set());
  return height;
}

function exprLeaves(expr: PrereqExpr): string[] {
  if ("course" in expr) return [expr.course];
  const children = "and" in expr ? expr.and : expr.or;
  return children.flatMap(exprLeaves);
}

/** DFS cycle detection over prerequisite edges among selected courses. */
function findPrereqCycle(
  selected: string[],
  courseMap: ReadonlyMap<string, Course>,
  codeToId: ReadonlyMap<string, string>,
): string[] | null {
  const selectedSet = new Set(selected);
  const state = new Map<string, "visiting" | "done">();
  const parent = new Map<string, string>();
  let cycle: string[] | null = null;
  const visit = (id: string): boolean => {
    state.set(id, "visiting");
    const c = courseMap.get(id);
    if (c) {
      for (const p of c.prerequisites) {
        for (const code of exprLeaves(p.expression)) {
          const pid = codeToId.get(code);
          if (!pid || !selectedSet.has(pid)) continue;
          const s = state.get(pid);
          if (s === "visiting") {
            // reconstruct
            const path = [pid, id];
            let cur = id;
            while (parent.has(cur) && cur !== pid) {
              cur = parent.get(cur)!;
              path.push(cur);
            }
            cycle = path.reverse();
            return true;
          }
          if (s === undefined) {
            parent.set(pid, id);
            if (visit(pid)) return true;
          }
        }
      }
    }
    state.set(id, "done");
    return false;
  };
  for (const id of selected) {
    if (!state.has(id) && visit(id)) break;
  }
  return cycle;
}

// ---------------------------------------------------------------------------

function degreeAccounting(
  req: ScheduleRequest,
  programsToSatisfy: Program[],
): {
  denominator: number;
  countedCategories: Set<string>;
  categoryCaps: Map<string, number>;
} {
  const combined =
    req.options?.ptdDenominator === "combined" && !!req.secondaryProgram;
  const countedPrograms = combined
    ? [req.program, req.secondaryProgram!]
    : [req.program];
  const countedCategories = new Set<string>();
  const categoryCaps = new Map<string, number>();
  for (const p of programsToSatisfy) {
    for (const c of p.categories) {
      categoryCaps.set(c.id, c.creditsRequired);
    }
  }
  for (const p of countedPrograms) {
    for (const c of p.categories) countedCategories.add(c.id);
  }
  const denominator = countedPrograms.reduce(
    (s, p) => s + p.totalCreditsRequired,
    0,
  );
  return { denominator, countedCategories, categoryCaps };
}

function buildExplanation(
  req: ScheduleRequest,
  unscheduled: string[],
  deliveredPrimary: number,
  requestedPrimary: number,
  courseMap: ReadonlyMap<string, Course>,
  codeToId: ReadonlyMap<string, string>,
  resolved: ResolvedRequirements,
): string {
  void codeToId;
  void resolved;
  const parts: string[] = [];
  if (deliveredPrimary > requestedPrimary && unscheduled.length === 0) {
    parts.push(
      `The requested ${requestedPrimary}-semester target is infeasible: required courses (prerequisite chains and term-offering cadence) cannot fit in ${requestedPrimary} semesters. The closest feasible plan uses ${deliveredPrimary} semesters and is shown instead.`,
    );
  }
  if (unscheduled.length > 0) {
    const names = unscheduled
      .map((id) => courseMap.get(id)?.code ?? id)
      .sort()
      .join(", ");
    parts.push(
      `Even after extending the plan, these courses could not be placed: ${names}. Check offering cadence and prerequisite chains, or reduce the requirement load.`,
    );
  }
  return parts.join(" ");
}

function emptyResult(
  req: ScheduleRequest,
  resolved: ResolvedRequirements,
  dataErrors: string[],
): ScheduleResult {
  return {
    feasible: false,
    explanation: dataErrors.join(" "),
    terms: [],
    unscheduledCourseIds: resolved.toSchedule,
    assignments: Object.fromEntries(resolved.assignments),
    totalCreditsRequired: req.program.totalCreditsRequired,
    incomingDegreeCredits: 0,
    requestedPrimaryTerms: TARGET_PRIMARY_TERMS[req.target],
    deliveredPrimaryTerms: 0,
    dataErrors,
  };
}
