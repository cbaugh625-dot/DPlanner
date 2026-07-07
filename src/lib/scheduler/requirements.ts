import type { Course, IncomingCredit, PrereqExpr, Program } from "../types";

export interface CategoryAssignment {
  programId: string;
  categoryId: string;
}

export interface ResolvedRequirements {
  /** Course IDs that must be scheduled (not already satisfied). */
  toSchedule: string[];
  /** courseId → categories it satisfies (may span programs). */
  assignments: Map<string, CategoryAssignment[]>;
  /** Courses satisfied before term 1 (incoming credit), with their assignments. */
  satisfiedByIncoming: Map<string, CategoryAssignment[]>;
  /** categoryId → credits applied directly by category-level incoming credit. */
  categoryIncomingCredits: Map<string, number>;
  /** Data problems (e.g. an elective pool that cannot be satisfied). */
  errors: string[];
}

/**
 * Compute the concrete set of courses to schedule for one or more programs
 * (primary major, optional second major, optional minors), after subtracting
 * incoming credit.
 *
 * Rules:
 * - Consumption is per-program: a course can satisfy at most one category in
 *   EACH program (a minor's course may double as the major's free elective;
 *   a double major shares gen-eds), but never two categories of the same
 *   program.
 * - all_of categories are resolved first (they are mandatory); choose_n pools
 *   are resolved second, preferring courses already selected for another
 *   program (minimizes total courseload), then already-satisfied credit, then
 *   shallow prerequisite chains, then lower difficulty.
 * - Incoming credit against a category reduces that category's remaining
 *   credits before course selection.
 */
export function resolveRequirements(
  programsToSatisfy: Program[],
  courses: ReadonlyMap<string, Course>,
  incoming: IncomingCredit[],
): ResolvedRequirements {
  const errors: string[] = [];
  const assignments = new Map<string, CategoryAssignment[]>();
  const satisfiedByIncoming = new Map<string, CategoryAssignment[]>();
  const categoryIncomingCredits = new Map<string, number>();

  const incomingCourseIds = new Set<string>();
  for (const ic of incoming) {
    if (ic.satisfiesCourseId) incomingCourseIds.add(ic.satisfiesCourseId);
    if (ic.satisfiesRequirementCategoryId) {
      categoryIncomingCredits.set(
        ic.satisfiesRequirementCategoryId,
        (categoryIncomingCredits.get(ic.satisfiesRequirementCategoryId) ?? 0) +
          ic.credits,
      );
    }
  }

  // Per-program consumption: programId → set of course IDs already used by
  // one of that program's categories.
  const consumedByProgram = new Map<string, Set<string>>();
  const consumed = (programId: string) => {
    let s = consumedByProgram.get(programId);
    if (!s) {
      s = new Set();
      consumedByProgram.set(programId, s);
    }
    return s;
  };

  // --- prerequisite depth (for elective preference) -------------------------
  const codeToId = new Map<string, string>();
  for (const [id, c] of courses) codeToId.set(c.code, id);
  const depthCache = new Map<string, number>();
  const prereqDepth = (courseId: string, stack = new Set<string>()): number => {
    if (incomingCourseIds.has(courseId)) return 0;
    if (depthCache.has(courseId)) return depthCache.get(courseId)!;
    if (stack.has(courseId)) return 99; // cycle — the engine reports it
    stack.add(courseId);
    const course = courses.get(courseId);
    let depth = 0;
    if (course) {
      for (const p of course.prerequisites) {
        depth = Math.max(depth, exprDepth(p.expression, stack));
      }
    }
    stack.delete(courseId);
    depthCache.set(courseId, depth);
    return depth;
  };
  const exprDepth = (expr: PrereqExpr, stack: Set<string>): number => {
    if ("course" in expr) {
      const id = codeToId.get(expr.course);
      if (!id || incomingCourseIds.has(id)) return 0;
      return 1 + prereqDepth(id, stack);
    }
    if ("and" in expr) {
      return expr.and.reduce((d, e) => Math.max(d, exprDepth(e, stack)), 0);
    }
    // OR: the easiest branch decides the effective depth.
    const d = expr.or.reduce((m, e) => Math.min(m, exprDepth(e, stack)), Infinity);
    return d === Infinity ? 0 : d;
  };

  const addAssignment = (
    map: Map<string, CategoryAssignment[]>,
    courseId: string,
    a: CategoryAssignment,
  ) => {
    const list = map.get(courseId) ?? [];
    list.push(a);
    map.set(courseId, list);
  };

  // --- Pass 1: all_of categories (mandatory) ---------------------------------
  for (const program of programsToSatisfy) {
    const cats = [...program.categories].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const cat of cats) {
      if (cat.ruleType !== "all_of") continue;
      const a: CategoryAssignment = { programId: program.id, categoryId: cat.id };
      for (const courseId of cat.courseIds) {
        consumed(program.id).add(courseId);
        if (incomingCourseIds.has(courseId)) {
          addAssignment(satisfiedByIncoming, courseId, a);
        } else {
          addAssignment(assignments, courseId, a);
        }
      }
    }
  }

  // --- Closure cost helpers ----------------------------------------------------
  // Cheapest set of extra (not yet selected / not incoming) courses needed to
  // satisfy a prerequisite expression. Used both to bias elective selection
  // toward courses the student must take anyway, and for the final closure.
  const satisfiable = (id: string) =>
    assignments.has(id) || incomingCourseIds.has(id);
  const costCache = new Map<string, { cost: number; adds: Set<string> }>();
  const courseCost = (
    id: string,
    stack: Set<string>,
  ): { cost: number; adds: Set<string> } => {
    if (satisfiable(id)) return { cost: 0, adds: new Set() };
    if (costCache.has(id)) return costCache.get(id)!;
    if (stack.has(id)) return { cost: 9999, adds: new Set() };
    stack.add(id);
    const course = courses.get(id);
    const adds = new Set<string>([id]);
    let cost = course?.credits ?? 3;
    if (course) {
      for (const p of course.prerequisites) {
        const sub = exprCost(p.expression, stack);
        cost += sub.cost;
        for (const a of sub.adds) adds.add(a);
      }
    }
    stack.delete(id);
    const res = { cost, adds };
    costCache.set(id, res);
    return res;
  };
  const exprCost = (
    expr: PrereqExpr,
    stack: Set<string>,
  ): { cost: number; adds: Set<string> } => {
    if ("course" in expr) {
      const id = codeToId.get(expr.course);
      if (!id) return { cost: 0, adds: new Set() };
      return courseCost(id, stack);
    }
    if ("and" in expr) {
      const adds = new Set<string>();
      let cost = 0;
      for (const e of expr.and) {
        const sub = exprCost(e, stack);
        cost += sub.cost;
        for (const a of sub.adds) adds.add(a);
      }
      return { cost, adds };
    }
    let best: { cost: number; adds: Set<string> } = {
      cost: Infinity,
      adds: new Set(),
    };
    for (const e of expr.or) {
      const sub = exprCost(e, stack);
      if (sub.cost < best.cost) best = sub;
    }
    return best.cost === Infinity ? { cost: 0, adds: new Set() } : best;
  };

  // Support set: courses needed purely as prerequisites of the mandatory
  // (all_of) selection. Elective pools prefer these — the student takes them
  // anyway, so absorbing them into a pool wastes no credits.
  const supportSet = new Set<string>();
  for (const id of assignments.keys()) {
    const course = courses.get(id);
    if (!course) continue;
    for (const p of course.prerequisites) {
      for (const a of exprCost(p.expression, new Set()).adds) supportSet.add(a);
    }
  }

  // --- Pass 2: choose_n pools -------------------------------------------------
  for (const program of programsToSatisfy) {
    const cats = [...program.categories].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const cat of cats) {
      if (cat.ruleType === "all_of") continue;
      const a: CategoryAssignment = { programId: program.id, categoryId: cat.id };
      const used = consumed(program.id);

      const incomingCatCredits = categoryIncomingCredits.get(cat.id) ?? 0;
      let neededCredits =
        cat.ruleType === "choose_n_credits"
          ? Math.max(0, (cat.ruleValue ?? cat.creditsRequired) - incomingCatCredits)
          : 0;
      let neededCourses =
        cat.ruleType === "choose_n_courses" ? (cat.ruleValue ?? 0) : 0;

      const take = (courseId: string, map: Map<string, CategoryAssignment[]>) => {
        const credits = courses.get(courseId)?.credits ?? 0;
        addAssignment(map, courseId, a);
        used.add(courseId);
        neededCredits = Math.max(0, neededCredits - credits);
        neededCourses = Math.max(0, neededCourses - 1);
      };

      // 1) incoming course credit in this pool
      for (const courseId of cat.courseIds) {
        if (neededCredits <= 0 && neededCourses <= 0) break;
        if (incomingCourseIds.has(courseId) && !used.has(courseId)) {
          take(courseId, satisfiedByIncoming);
        }
      }
      if (neededCredits <= 0 && neededCourses <= 0) continue;

      // 2) remaining candidates, preferring courses already being scheduled
      //    for another program, then shallow chains, then easier courses.
      const candidates = cat.courseIds
        .filter((id) => !used.has(id) && courses.has(id))
        .sort((x, y) => {
          const sharedX = assignments.has(x) || supportSet.has(x) ? 0 : 1;
          const sharedY = assignments.has(y) || supportSet.has(y) ? 0 : 1;
          if (sharedX !== sharedY) return sharedX - sharedY;
          const dx = prereqDepth(x);
          const dy = prereqDepth(y);
          if (dx !== dy) return dx - dy;
          const cx = courses.get(x)!;
          const cy = courses.get(y)!;
          const diffX = cx.difficulty ?? 3;
          const diffY = cy.difficulty ?? 3;
          if (diffX !== diffY) return diffX - diffY;
          return cx.code.localeCompare(cy.code);
        });

      for (const courseId of candidates) {
        if (neededCredits <= 0 && neededCourses <= 0) break;
        take(courseId, assignments);
      }

      if (neededCredits > 0 || neededCourses > 0) {
        errors.push(
          `Requirement "${cat.name}" of ${program.name} cannot be satisfied: ` +
            (cat.ruleType === "choose_n_courses"
              ? `${neededCourses} more course(s) needed but the candidate pool is exhausted.`
              : `${neededCredits} more credit(s) needed but the candidate pool is exhausted.`),
        );
      }
    }
  }

  // --- Pass 3: prerequisite closure -------------------------------------------
  // Selected courses may need prerequisites that are not themselves part of
  // any requirement. Those support courses must still be scheduled; they
  // carry no category assignment (their credits count toward term load, not
  // degree progress), unless an elective pool already absorbed them above.
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const id of [...assignments.keys()]) {
      const course = courses.get(id);
      if (!course) continue;
      for (const p of course.prerequisites) {
        const { adds } = exprCost(p.expression, new Set());
        for (const add of adds) {
          if (!assignments.has(add) && !incomingCourseIds.has(add)) {
            assignments.set(add, []); // support course, no category credit
            costCache.clear();
            changed = true;
          }
        }
      }
    }
  }

  return {
    toSchedule: [...assignments.keys()],
    assignments,
    satisfiedByIncoming,
    categoryIncomingCredits,
    errors,
  };
}
