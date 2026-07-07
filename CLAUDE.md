# DPlanner — Student-Athlete Course Planner

Advisor-facing, multi-tenant web app that generates multi-year course plans
for college student-athletes and checks them against NCAA eligibility rules.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Postgres (Supabase-compatible) via Drizzle ORM (`src/db/schema.ts`, migrations in `drizzle/`)
- Pure, framework-free domain modules: `src/lib/scheduler`, `src/lib/eligibility`, `src/lib/importer`
- Vitest for tests (`pnpm test`)

## Commands

- `pnpm dev` — dev server
- `pnpm build` — production build
- `pnpm test` — run Vitest
- `pnpm db:migrate` — apply Drizzle migrations
- `pnpm seed` — idempotent import of the LSU demo dataset (`seed-data/lsu/`)
- `docker compose up -d db` — local Postgres (or use an existing `DATABASE_URL`)

## Hard rules

- All data is scoped by `institution_id` (multi-tenant from day one).
- All students are synthetic (`is_sample = true`); no real student records or SIS integration in v1.
- NCAA eligibility numbers are NEVER hardcoded — always read from the active
  `eligibility_rulesets` row for the student's division + enrollment date.
- The demo banner and compliance disclaimer must remain visible in the app and
  on every exported plan.
