CREATE TYPE "public"."offering_cadence" AS ENUM('every_year', 'alternate_years_odd', 'alternate_years_even');--> statement-breakpoint
CREATE TYPE "public"."division" AS ENUM('D1', 'D2', 'D3', 'NAIA');--> statement-breakpoint
CREATE TYPE "public"."flag_severity" AS ENUM('error', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."grad_target" AS ENUM('grad_3yr', 'grad_3_5yr', 'grad_4yr', 'grad_4_5yr', 'grad_5yr');--> statement-breakpoint
CREATE TYPE "public"."incoming_credit_source" AS ENUM('AP', 'IB', 'dual_enrollment', 'transfer', 'clep');--> statement-breakpoint
CREATE TYPE "public"."prerequisite_type" AS ENUM('prerequisite', 'corequisite');--> statement-breakpoint
CREATE TYPE "public"."program_type" AS ENUM('major', 'minor');--> statement-breakpoint
CREATE TYPE "public"."ptd_denominator" AS ENUM('primary_only', 'combined');--> statement-breakpoint
CREATE TYPE "public"."requirement_rule_type" AS ENUM('all_of', 'choose_n_courses', 'choose_n_credits');--> statement-breakpoint
CREATE TYPE "public"."strategy" AS ENUM('balanced', 'front_load_hard', 'light_in_season', 'summer_accelerated');--> statement-breakpoint
CREATE TYPE "public"."term_type" AS ENUM('fall', 'spring', 'summer', 'winter');--> statement-breakpoint
CREATE TABLE "academic_terms_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"term_type" "term_type" NOT NULL,
	"min_credits" integer NOT NULL,
	"max_credits" integer NOT NULL,
	"full_time_threshold" integer
);
--> statement-breakpoint
CREATE TABLE "athletic_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"sport" text NOT NULL,
	"championship_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_season_weeks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"practice_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"typical_travel_pattern" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"offered_fall" boolean DEFAULT false NOT NULL,
	"offered_spring" boolean DEFAULT false NOT NULL,
	"offered_summer" boolean DEFAULT false NOT NULL,
	"offered_winter" boolean DEFAULT false NOT NULL,
	"cadence" "offering_cadence" DEFAULT 'every_year' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"credits" integer NOT NULL,
	"description" text,
	"difficulty" integer
);
--> statement-breakpoint
CREATE TABLE "eligibility_rulesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division" "division" NOT NULL,
	"effective_date" date NOT NULL,
	"rules" jsonb NOT NULL,
	"source_note" text,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incoming_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"source" "incoming_credit_source" NOT NULL,
	"satisfies_course_id" uuid,
	"satisfies_requirement_category_id" uuid,
	"credits" integer NOT NULL,
	"grade" text
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"division" "division" NOT NULL,
	"min_graduation_gpa" numeric(3, 2) NOT NULL,
	"default_degree_credits" integer NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "plan_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"term" text,
	"severity" "flag_severity" NOT NULL,
	"rule_key" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"term" text NOT NULL,
	"term_index" integer NOT NULL,
	"course_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_credits" integer DEFAULT 0 NOT NULL,
	"cumulative_degree_credits" integer DEFAULT 0 NOT NULL,
	"cumulative_degree_percent" numeric(5, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"secondary_program_id" uuid,
	"minor_program_ids" jsonb,
	"target" "grad_target" NOT NULL,
	"strategy" "strategy" NOT NULL,
	"ptd_denominator" "ptd_denominator" DEFAULT 'primary_only' NOT NULL,
	"study_abroad_terms" jsonb,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prerequisites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"prereq_expression" jsonb NOT NULL,
	"type" "prerequisite_type" DEFAULT 'prerequisite' NOT NULL,
	"min_grade" text
);
--> statement-breakpoint
CREATE TABLE "program_requirement_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_category_id" uuid NOT NULL,
	"course_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"degree_type" text NOT NULL,
	"catalog_year" text NOT NULL,
	"total_credits_required" integer NOT NULL,
	"type" "program_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"credits_required" integer NOT NULL,
	"rule_type" "requirement_rule_type" NOT NULL,
	"rule_value" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"sport" text NOT NULL,
	"division" "division" NOT NULL,
	"enrollment_start_term" text NOT NULL,
	"current_cumulative_gpa" numeric(3, 2),
	"is_sample" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_terms_config" ADD CONSTRAINT "academic_terms_config_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletic_calendars" ADD CONSTRAINT "athletic_calendars_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_credits" ADD CONSTRAINT "incoming_credits_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_credits" ADD CONSTRAINT "incoming_credits_satisfies_course_id_courses_id_fk" FOREIGN KEY ("satisfies_course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_credits" ADD CONSTRAINT "incoming_credits_satisfies_requirement_category_id_requirement_categories_id_fk" FOREIGN KEY ("satisfies_requirement_category_id") REFERENCES "public"."requirement_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_flags" ADD CONSTRAINT "plan_flags_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_terms" ADD CONSTRAINT "plan_terms_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_secondary_program_id_programs_id_fk" FOREIGN KEY ("secondary_program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prerequisites" ADD CONSTRAINT "prerequisites_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_requirement_courses" ADD CONSTRAINT "program_requirement_courses_requirement_category_id_requirement_categories_id_fk" FOREIGN KEY ("requirement_category_id") REFERENCES "public"."requirement_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_requirement_courses" ADD CONSTRAINT "program_requirement_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_categories" ADD CONSTRAINT "requirement_categories_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_config_inst_type_uq" ON "academic_terms_config" USING btree ("institution_id","term_type");--> statement-breakpoint
CREATE UNIQUE INDEX "athletic_cal_inst_sport_uq" ON "athletic_calendars" USING btree ("institution_id","sport");--> statement-breakpoint
CREATE UNIQUE INDEX "offerings_course_uq" ON "course_offerings" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_inst_code_uq" ON "courses" USING btree ("institution_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_terms_plan_idx_uq" ON "plan_terms" USING btree ("plan_id","term_index");--> statement-breakpoint
CREATE UNIQUE INDEX "prereq_course_type_uq" ON "prerequisites" USING btree ("course_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "prc_cat_course_uq" ON "program_requirement_courses" USING btree ("requirement_category_id","course_id");--> statement-breakpoint
CREATE INDEX "prc_course_idx" ON "program_requirement_courses" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_inst_slug_uq" ON "programs" USING btree ("institution_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "req_cat_program_slug_uq" ON "requirement_categories" USING btree ("program_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "students_inst_slug_uq" ON "students" USING btree ("institution_id","slug");