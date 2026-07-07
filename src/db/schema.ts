import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const divisionEnum = pgEnum("division", ["D1", "D2", "D3", "NAIA"]);

export const termTypeEnum = pgEnum("term_type", [
  "fall",
  "spring",
  "summer",
  "winter",
]);

export const programTypeEnum = pgEnum("program_type", ["major", "minor"]);

export const requirementRuleTypeEnum = pgEnum("requirement_rule_type", [
  "all_of",
  "choose_n_courses",
  "choose_n_credits",
]);

export const prerequisiteTypeEnum = pgEnum("prerequisite_type", [
  "prerequisite",
  "corequisite",
]);

export const incomingCreditSourceEnum = pgEnum("incoming_credit_source", [
  "AP",
  "IB",
  "dual_enrollment",
  "transfer",
  "clep",
]);

export const gradTargetEnum = pgEnum("grad_target", [
  "grad_3yr",
  "grad_3_5yr",
  "grad_4yr",
  "grad_4_5yr",
  "grad_5yr",
]);

export const strategyEnum = pgEnum("strategy", [
  "balanced",
  "front_load_hard",
  "light_in_season",
  "summer_accelerated",
]);

export const flagSeverityEnum = pgEnum("flag_severity", [
  "error",
  "warning",
  "info",
]);

export const cadenceEnum = pgEnum("offering_cadence", [
  "every_year",
  "alternate_years_odd",
  "alternate_years_even",
]);

// PTD denominator handling for double majors within the same degree program.
// NCAA gives the institution discretion: combine both majors' requirements
// into the denominator, or count only the primary major.
export const ptdDenominatorEnum = pgEnum("ptd_denominator", [
  "primary_only",
  "combined",
]);

// ---------------------------------------------------------------------------
// Institutions & calendar
// ---------------------------------------------------------------------------

export const institutions = pgTable("institutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stable, importer-friendly identifier (e.g. "lsu"). Unique per deployment.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  division: divisionEnum("division").notNull(),
  minGraduationGpa: numeric("min_graduation_gpa", {
    precision: 3,
    scale: 2,
  }).notNull(),
  defaultDegreeCredits: integer("default_degree_credits").notNull(),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const academicTermsConfig = pgTable(
  "academic_terms_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    termType: termTypeEnum("term_type").notNull(),
    minCredits: integer("min_credits").notNull(),
    maxCredits: integer("max_credits").notNull(),
    // Full-time threshold (e.g. 12 for fall/spring). Null for optional terms
    // like summer where full-time enrollment is not expected.
    fullTimeThreshold: integer("full_time_threshold"),
  },
  (t) => [uniqueIndex("terms_config_inst_type_uq").on(t.institutionId, t.termType)],
);

// ---------------------------------------------------------------------------
// Programs & requirements
// ---------------------------------------------------------------------------

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    degreeType: text("degree_type").notNull(), // BA / BS / BFA / ...
    catalogYear: text("catalog_year").notNull(), // e.g. "2025-2026"
    totalCreditsRequired: integer("total_credits_required").notNull(),
    type: programTypeEnum("type").notNull(),
  },
  (t) => [uniqueIndex("programs_inst_slug_uq").on(t.institutionId, t.slug)],
);

export const requirementCategories = pgTable(
  "requirement_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    creditsRequired: integer("credits_required").notNull(),
    ruleType: requirementRuleTypeEnum("rule_type").notNull(),
    // choose_n_courses → number of courses; choose_n_credits → number of
    // credits (usually equals credits_required); null for all_of.
    ruleValue: integer("rule_value"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("req_cat_program_slug_uq").on(t.programId, t.slug)],
);

// ---------------------------------------------------------------------------
// Courses, offerings, prerequisites
// ---------------------------------------------------------------------------

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // e.g. "MATH 1550"
    title: text("title").notNull(),
    credits: integer("credits").notNull(),
    description: text("description"),
    // 1 (easy) – 5 (hard). Used by front_load_hard / light_in_season.
    difficulty: integer("difficulty"),
  },
  (t) => [uniqueIndex("courses_inst_code_uq").on(t.institutionId, t.code)],
);

export const courseOfferings = pgTable(
  "course_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    offeredFall: boolean("offered_fall").notNull().default(false),
    offeredSpring: boolean("offered_spring").notNull().default(false),
    offeredSummer: boolean("offered_summer").notNull().default(false),
    offeredWinter: boolean("offered_winter").notNull().default(false),
    cadence: cadenceEnum("cadence").notNull().default("every_year"),
  },
  (t) => [uniqueIndex("offerings_course_uq").on(t.courseId)],
);

/**
 * prereq_expression jsonb boolean tree, e.g.
 * {"and":[{"course":"MATH 1550"},{"or":[{"course":"ENGL 1001"},{"course":"ENGL 1004"}]}]}
 * Leaves reference course *codes* (import-friendly); the importer validates
 * they exist for the institution.
 */
export const prerequisites = pgTable(
  "prerequisites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    prereqExpression: jsonb("prereq_expression").notNull(),
    type: prerequisiteTypeEnum("type").notNull().default("prerequisite"),
    minGrade: text("min_grade"), // e.g. "C"
  },
  (t) => [uniqueIndex("prereq_course_type_uq").on(t.courseId, t.type)],
);

export const programRequirementCourses = pgTable(
  "program_requirement_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requirementCategoryId: uuid("requirement_category_id")
      .notNull()
      .references(() => requirementCategories.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("prc_cat_course_uq").on(t.requirementCategoryId, t.courseId),
    index("prc_course_idx").on(t.courseId),
  ],
);

// ---------------------------------------------------------------------------
// Students (SAMPLE ONLY in v1)
// ---------------------------------------------------------------------------

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    sport: text("sport").notNull(),
    division: divisionEnum("division").notNull(),
    enrollmentStartTerm: text("enrollment_start_term").notNull(), // "Fall 2025"
    currentCumulativeGpa: numeric("current_cumulative_gpa", {
      precision: 3,
      scale: 2,
    }),
    isSample: boolean("is_sample").notNull().default(true),
  },
  (t) => [uniqueIndex("students_inst_slug_uq").on(t.institutionId, t.slug)],
);

export const incomingCredits = pgTable("incoming_credits", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  source: incomingCreditSourceEnum("source").notNull(),
  // Exactly one of these two may be set: credit for a specific course, or a
  // generic credit block applied against a requirement category.
  satisfiesCourseId: uuid("satisfies_course_id").references(() => courses.id, {
    onDelete: "set null",
  }),
  satisfiesRequirementCategoryId: uuid(
    "satisfies_requirement_category_id",
  ).references(() => requirementCategories.id, { onDelete: "set null" }),
  credits: integer("credits").notNull(),
  grade: text("grade"),
});

// ---------------------------------------------------------------------------
// Athletic calendars
// ---------------------------------------------------------------------------

export const athleticCalendars = pgTable(
  "athletic_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    sport: text("sport").notNull(),
    // Which term types hold the championship (competition) season,
    // e.g. ["fall"] for football, ["spring"] for baseball.
    championshipTerms: jsonb("championship_terms").notNull().default([]),
    inSeasonWeeks: jsonb("in_season_weeks").notNull().default([]),
    practiceBlocks: jsonb("practice_blocks").notNull().default([]),
    typicalTravelPattern: jsonb("typical_travel_pattern").notNull().default({}),
  },
  (t) => [uniqueIndex("athletic_cal_inst_sport_uq").on(t.institutionId, t.sport)],
);

// ---------------------------------------------------------------------------
// Eligibility rulesets (data-driven — never hardcode NCAA numbers)
// ---------------------------------------------------------------------------

export const eligibilityRulesets = pgTable("eligibility_rulesets", {
  id: uuid("id").primaryKey().defaultRandom(),
  division: divisionEnum("division").notNull(),
  effectiveDate: date("effective_date").notNull(),
  rules: jsonb("rules").notNull(),
  sourceNote: text("source_note"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id, { onDelete: "cascade" }),
  secondaryProgramId: uuid("secondary_program_id").references(
    () => programs.id,
    { onDelete: "set null" },
  ),
  minorProgramIds: jsonb("minor_program_ids"), // uuid[] | null
  target: gradTargetEnum("target").notNull(),
  strategy: strategyEnum("strategy").notNull(),
  // Double-major PTD denominator option (institution discretion per NCAA).
  ptdDenominator: ptdDenominatorEnum("ptd_denominator")
    .notNull()
    .default("primary_only"),
  // Terms flagged study-abroad: jsonb array of term labels, e.g. ["Fall 2027"].
  studyAbroadTerms: jsonb("study_abroad_terms"),
  // Scheduler metadata: feasibility notes, requested-vs-delivered target, etc.
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const planTerms = pgTable(
  "plan_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    term: text("term").notNull(), // "Fall 2025"
    termIndex: integer("term_index").notNull(), // 1-based ordinal
    courseIds: jsonb("course_ids").notNull().default([]), // uuid[]
    totalCredits: integer("total_credits").notNull().default(0),
    cumulativeDegreeCredits: integer("cumulative_degree_credits")
      .notNull()
      .default(0),
    cumulativeDegreePercent: numeric("cumulative_degree_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0"),
  },
  (t) => [uniqueIndex("plan_terms_plan_idx_uq").on(t.planId, t.termIndex)],
);

export const planFlags = pgTable("plan_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  term: text("term"), // null for annual/cumulative flags
  severity: flagSeverityEnum("severity").notNull(),
  ruleKey: text("rule_key").notNull(), // e.g. "ptd_40_percent"
  message: text("message").notNull(),
});
