import { parseCsv, type CsvRow } from "./csv";
import {
  parsePrereqExpression,
  courseCodesInExpression,
} from "./prereqExpr";
import type {
  BundleAthleticCalendar,
  BundleCategory,
  BundleCourse,
  BundleInstitution,
  BundleMapping,
  BundlePrerequisite,
  BundleProgram,
  CatalogBundle,
  ImportError,
  ParseResult,
  RawImportFiles,
} from "./types";
import type { Division, RequirementRuleType, TermType } from "../types";

const DIVISIONS: Division[] = ["D1", "D2", "D3", "NAIA"];
const TERM_TYPES: TermType[] = ["fall", "spring", "summer", "winter"];
const RULE_TYPES: RequirementRuleType[] = [
  "all_of",
  "choose_n_courses",
  "choose_n_credits",
];
const CADENCES = ["every_year", "alternate_years_odd", "alternate_years_even"];

/**
 * Parse + validate a full institution import. Collects ALL errors instead of
 * failing on the first; returns a bundle only if the data is fully valid.
 */
export function parseCatalog(files: RawImportFiles): ParseResult {
  const errors: ImportError[] = [];
  const err = (file: string, message: string, line?: number, field?: string) =>
    errors.push({ file, line, field, message });

  // --- institution.json ----------------------------------------------------
  let institution: BundleInstitution | null = null;
  {
    const file = "institution.json";
    let raw: unknown;
    try {
      raw = JSON.parse(files[file]);
    } catch (e) {
      err(file, `invalid JSON: ${(e as Error).message}`);
      raw = null;
    }
    if (raw !== null) {
      if (typeof raw !== "object" || Array.isArray(raw)) {
        err(file, "top level must be an object");
      } else {
        const o = raw as Record<string, unknown>;
        const slug = str(o.slug);
        const name = str(o.name);
        const division = str(o.division) as Division;
        const minGpa = num(o.min_graduation_gpa);
        const degCredits = int(o.default_degree_credits);
        if (!slug) err(file, "slug is required", undefined, "slug");
        if (!name) err(file, "name is required", undefined, "name");
        if (!DIVISIONS.includes(division))
          err(
            file,
            `division must be one of ${DIVISIONS.join(", ")}`,
            undefined,
            "division",
          );
        if (minGpa === null || minGpa < 0 || minGpa > 4)
          err(file, "min_graduation_gpa must be a number 0–4", undefined, "min_graduation_gpa");
        if (degCredits === null || degCredits <= 0)
          err(file, "default_degree_credits must be a positive integer", undefined, "default_degree_credits");

        const terms: BundleInstitution["terms"] = [];
        if (!Array.isArray(o.terms) || o.terms.length === 0) {
          err(file, "terms must be a non-empty array", undefined, "terms");
        } else {
          const seen = new Set<string>();
          o.terms.forEach((t: unknown, i: number) => {
            const to = (t ?? {}) as Record<string, unknown>;
            const termType = str(to.term_type) as TermType;
            if (!TERM_TYPES.includes(termType)) {
              err(file, `terms[${i}].term_type must be one of ${TERM_TYPES.join(", ")}`, undefined, "terms");
              return;
            }
            if (seen.has(termType)) {
              err(file, `duplicate term_type "${termType}" in terms`, undefined, "terms");
              return;
            }
            seen.add(termType);
            const minC = int(to.min_credits);
            const maxC = int(to.max_credits);
            const ft = to.full_time_threshold == null ? null : int(to.full_time_threshold);
            if (minC === null || minC < 0)
              err(file, `terms[${i}].min_credits must be a non-negative integer`, undefined, "terms");
            if (maxC === null || maxC <= 0)
              err(file, `terms[${i}].max_credits must be a positive integer`, undefined, "terms");
            if (minC !== null && maxC !== null && minC > maxC)
              err(file, `terms[${i}]: min_credits > max_credits`, undefined, "terms");
            terms.push({
              termType,
              minCredits: minC ?? 0,
              maxCredits: maxC ?? 0,
              fullTimeThreshold: ft,
            });
          });
        }
        institution = {
          slug: slug ?? "",
          name: name ?? "",
          division,
          minGraduationGpa: minGpa ?? 0,
          defaultDegreeCredits: degCredits ?? 0,
          settings:
            typeof o.settings === "object" && o.settings !== null
              ? (o.settings as Record<string, unknown>)
              : {},
          terms,
        };
      }
    }
  }

  // --- programs.csv --------------------------------------------------------
  const programs: BundleProgram[] = [];
  {
    const file = "programs.csv";
    const rows = readRows(files[file], file, ["slug", "name", "degree_type", "catalog_year", "total_credits_required", "type"], errors);
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row.values;
      let ok = true;
      if (!v.slug) {
        err(file, "slug is required", row.line, "slug");
        ok = false;
      } else if (seen.has(v.slug)) {
        err(file, `duplicate program slug "${v.slug}"`, row.line, "slug");
        ok = false;
      }
      if (!v.name) {
        err(file, "name is required", row.line, "name");
        ok = false;
      }
      const total = int(v.total_credits_required);
      if (total === null || total <= 0) {
        err(file, "total_credits_required must be a positive integer", row.line, "total_credits_required");
        ok = false;
      }
      if (v.type !== "major" && v.type !== "minor") {
        err(file, `type must be "major" or "minor" (got "${v.type}")`, row.line, "type");
        ok = false;
      }
      if (!ok) continue;
      seen.add(v.slug);
      programs.push({
        slug: v.slug,
        name: v.name,
        degreeType: v.degree_type,
        catalogYear: v.catalog_year,
        totalCreditsRequired: total!,
        type: v.type as "major" | "minor",
      });
    }
  }
  const programSlugs = new Set(programs.map((p) => p.slug));

  // --- courses.csv ----------------------------------------------------------
  const courses: BundleCourse[] = [];
  {
    const file = "courses.csv";
    const rows = readRows(files[file], file, ["code", "title", "credits", "offered_fall", "offered_spring", "offered_summer", "offered_winter", "cadence"], errors);
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row.values;
      let ok = true;
      if (!v.code) {
        err(file, "code is required", row.line, "code");
        ok = false;
      } else if (seen.has(v.code)) {
        err(file, `duplicate course code "${v.code}"`, row.line, "code");
        ok = false;
      }
      if (!v.title) {
        err(file, "title is required", row.line, "title");
        ok = false;
      }
      const credits = int(v.credits);
      if (credits === null || credits <= 0 || credits > 12) {
        err(file, `credits must be an integer 1–12 (got "${v.credits}")`, row.line, "credits");
        ok = false;
      }
      let difficulty: number | null = null;
      if (v.difficulty) {
        difficulty = int(v.difficulty);
        if (difficulty === null || difficulty < 1 || difficulty > 5) {
          err(file, `difficulty must be an integer 1–5 or blank (got "${v.difficulty}")`, row.line, "difficulty");
          ok = false;
        }
      }
      const flags: (boolean | null)[] = [
        bool(v.offered_fall),
        bool(v.offered_spring),
        bool(v.offered_summer),
        bool(v.offered_winter),
      ];
      const flagNames = ["offered_fall", "offered_spring", "offered_summer", "offered_winter"];
      flags.forEach((f, i) => {
        if (f === null) {
          err(file, `${flagNames[i]} must be true/false (got "${v[flagNames[i]]}")`, row.line, flagNames[i]);
          ok = false;
        }
      });
      if (flags.every((f) => f === false)) {
        err(file, `course "${v.code}" is not offered in any term`, row.line);
        ok = false;
      }
      const cadence = v.cadence || "every_year";
      if (!CADENCES.includes(cadence)) {
        err(file, `cadence must be one of ${CADENCES.join(", ")} (got "${v.cadence}")`, row.line, "cadence");
        ok = false;
      }
      if (!ok) continue;
      seen.add(v.code);
      courses.push({
        code: v.code,
        title: v.title,
        credits: credits!,
        description: v.description || null,
        difficulty,
        offeredFall: flags[0]!,
        offeredSpring: flags[1]!,
        offeredSummer: flags[2]!,
        offeredWinter: flags[3]!,
        cadence: cadence as BundleCourse["cadence"],
      });
    }
  }
  const courseCodes = new Set(courses.map((c) => c.code));

  // --- requirement_categories.csv -------------------------------------------
  const categories: BundleCategory[] = [];
  {
    const file = "requirement_categories.csv";
    const rows = readRows(files[file], file, ["program_slug", "slug", "name", "credits_required", "rule_type"], errors);
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row.values;
      let ok = true;
      if (!programSlugs.has(v.program_slug)) {
        err(file, `program_slug "${v.program_slug}" does not match any program in programs.csv`, row.line, "program_slug");
        ok = false;
      }
      if (!v.slug) {
        err(file, "slug is required", row.line, "slug");
        ok = false;
      }
      const key = `${v.program_slug}::${v.slug}`;
      if (seen.has(key)) {
        err(file, `duplicate category "${v.slug}" for program "${v.program_slug}"`, row.line, "slug");
        ok = false;
      }
      const credits = int(v.credits_required);
      if (credits === null || credits < 0) {
        err(file, "credits_required must be a non-negative integer", row.line, "credits_required");
        ok = false;
      }
      if (!RULE_TYPES.includes(v.rule_type as RequirementRuleType)) {
        err(file, `rule_type must be one of ${RULE_TYPES.join(", ")} (got "${v.rule_type}")`, row.line, "rule_type");
        ok = false;
      }
      let ruleValue: number | null = null;
      if (v.rule_type === "choose_n_courses" || v.rule_type === "choose_n_credits") {
        ruleValue = int(v.rule_value);
        if (ruleValue === null || ruleValue <= 0) {
          err(file, `rule_value is required (positive integer) for rule_type "${v.rule_type}"`, row.line, "rule_value");
          ok = false;
        }
      }
      if (!ok) continue;
      seen.add(key);
      categories.push({
        programSlug: v.program_slug,
        slug: v.slug,
        name: v.name || v.slug,
        creditsRequired: credits!,
        ruleType: v.rule_type as RequirementRuleType,
        ruleValue,
        sortOrder: int(v.sort_order) ?? 0,
      });
    }
  }
  const categoryKeys = new Set(categories.map((c) => `${c.programSlug}::${c.slug}`));

  // --- prerequisites.csv -----------------------------------------------------
  const prerequisites: BundlePrerequisite[] = [];
  {
    const file = "prerequisites.csv";
    const rows = readRows(files[file], file, ["course_code", "type", "expression"], errors);
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row.values;
      let ok = true;
      if (!courseCodes.has(v.course_code)) {
        err(file, `course_code "${v.course_code}" does not match any course in courses.csv`, row.line, "course_code");
        ok = false;
      }
      if (v.type !== "prerequisite" && v.type !== "corequisite") {
        err(file, `type must be "prerequisite" or "corequisite" (got "${v.type}")`, row.line, "type");
        ok = false;
      }
      const key = `${v.course_code}::${v.type}`;
      if (seen.has(key)) {
        err(file, `duplicate ${v.type} row for course "${v.course_code}" — combine into one expression`, row.line);
        ok = false;
      }
      let expression = null;
      try {
        expression = parsePrereqExpression(v.expression ?? "");
      } catch (e) {
        err(file, `invalid expression: ${(e as Error).message}`, row.line, "expression");
        ok = false;
      }
      if (expression) {
        for (const code of courseCodesInExpression(expression)) {
          if (!courseCodes.has(code)) {
            err(file, `expression references unknown course "${code}"`, row.line, "expression");
            ok = false;
          }
          if (code === v.course_code) {
            err(file, `course "${code}" cannot be its own ${v.type || "prerequisite"}`, row.line, "expression");
            ok = false;
          }
        }
      }
      if (!ok || !expression) continue;
      seen.add(key);
      prerequisites.push({
        courseCode: v.course_code,
        type: v.type as "prerequisite" | "corequisite",
        minGrade: v.min_grade || null,
        expression,
      });
    }
  }

  // --- requirement_mapping.csv -----------------------------------------------
  const mappings: BundleMapping[] = [];
  {
    const file = "requirement_mapping.csv";
    const rows = readRows(files[file], file, ["program_slug", "category_slug", "course_code"], errors);
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row.values;
      let ok = true;
      if (!categoryKeys.has(`${v.program_slug}::${v.category_slug}`)) {
        err(file, `category "${v.category_slug}" for program "${v.program_slug}" does not exist in requirement_categories.csv`, row.line);
        ok = false;
      }
      if (!courseCodes.has(v.course_code)) {
        err(file, `course_code "${v.course_code}" does not match any course in courses.csv`, row.line, "course_code");
        ok = false;
      }
      const key = `${v.program_slug}::${v.category_slug}::${v.course_code}`;
      if (seen.has(key)) {
        err(file, `duplicate mapping row (${v.program_slug}, ${v.category_slug}, ${v.course_code})`, row.line);
        ok = false;
      }
      if (!ok) continue;
      seen.add(key);
      mappings.push({
        programSlug: v.program_slug,
        categorySlug: v.category_slug,
        courseCode: v.course_code,
      });
    }
  }

  // --- athletic_calendars.csv --------------------------------------------------
  const athleticCalendars: BundleAthleticCalendar[] = [];
  {
    const file = "athletic_calendars.csv";
    const rows = readRows(files[file], file, ["sport", "championship_terms"], errors);
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row.values;
      let ok = true;
      if (!v.sport) {
        err(file, "sport is required", row.line, "sport");
        ok = false;
      } else if (seen.has(v.sport)) {
        err(file, `duplicate sport "${v.sport}"`, row.line, "sport");
        ok = false;
      }
      const champTerms = (v.championship_terms ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (champTerms.length === 0) {
        err(file, "championship_terms is required (pipe-separated term types, e.g. fall|spring)", row.line, "championship_terms");
        ok = false;
      }
      for (const t of champTerms) {
        if (!TERM_TYPES.includes(t as TermType)) {
          err(file, `championship_terms contains invalid term type "${t}"`, row.line, "championship_terms");
          ok = false;
        }
      }
      const inSeasonWeeks = jsonField(v.in_season_weeks, "[]", file, row, "in_season_weeks", errors);
      const practiceBlocks = jsonField(v.practice_blocks, "[]", file, row, "practice_blocks", errors);
      const travel = jsonField(v.typical_travel_pattern, "{}", file, row, "typical_travel_pattern", errors);
      if (inSeasonWeeks === undefined || practiceBlocks === undefined || travel === undefined) ok = false;
      if (!ok) continue;
      seen.add(v.sport);
      athleticCalendars.push({
        sport: v.sport,
        championshipTerms: champTerms as TermType[],
        inSeasonWeeks: (inSeasonWeeks as unknown[]) ?? [],
        practiceBlocks: (practiceBlocks as unknown[]) ?? [],
        typicalTravelPattern: (travel as Record<string, unknown>) ?? {},
      });
    }
  }

  // --- Cross-file sanity: every category has candidate courses ---------------
  for (const cat of categories) {
    const mapped = mappings.filter(
      (m) => m.programSlug === cat.programSlug && m.categorySlug === cat.slug,
    );
    if (mapped.length === 0) {
      err(
        "requirement_mapping.csv",
        `category "${cat.slug}" of program "${cat.programSlug}" has no courses mapped to it`,
      );
    } else {
      const mappedCredits = mapped.reduce((sum, m) => {
        const c = courses.find((c) => c.code === m.courseCode);
        return sum + (c?.credits ?? 0);
      }, 0);
      if (mappedCredits < cat.creditsRequired) {
        err(
          "requirement_mapping.csv",
          `category "${cat.slug}" of program "${cat.programSlug}" requires ${cat.creditsRequired} credits but its mapped courses only total ${mappedCredits}`,
        );
      }
    }
  }

  if (errors.length > 0 || !institution) {
    return { bundle: null, errors };
  }
  return {
    bundle: {
      institution,
      programs,
      categories,
      courses,
      prerequisites,
      mappings,
      athleticCalendars,
    },
    errors: [],
  };
}

// ---------------------------------------------------------------------------

function readRows(
  content: string | undefined,
  file: string,
  requiredColumns: string[],
  errors: ImportError[],
): CsvRow[] {
  if (content === undefined) {
    errors.push({ file, message: "file is missing" });
    return [];
  }
  const { header, rows } = parseCsv(content);
  const missing = requiredColumns.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    errors.push({
      file,
      line: 1,
      message: `missing required column(s): ${missing.join(", ")}`,
    });
    return [];
  }
  return rows;
}

function jsonField(
  value: string | undefined,
  fallback: string,
  file: string,
  row: CsvRow,
  field: string,
  errors: ImportError[],
): unknown | undefined {
  const raw = value && value.trim() !== "" ? value : fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    errors.push({
      file,
      line: row.line,
      field,
      message: `invalid JSON: ${(e as Error).message}`,
    });
    return undefined;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Number(v);
  return null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
}
function bool(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const s = v.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n", ""].includes(s)) return false;
  return null;
}
