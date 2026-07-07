import { listInstitutions } from "@/lib/data";
import { PlannerClient } from "@/components/PlannerClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  let institutions: Awaited<ReturnType<typeof listInstitutions>> = [];
  let dbError: string | null = null;
  try {
    institutions = await listInstitutions();
  } catch (e) {
    dbError = (e as Error).message;
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900">Course Planner</h1>
      <p className="mb-5 mt-1 text-sm text-slate-500">
        Build a semester-by-semester plan for a student-athlete from enrollment
        through graduation.
      </p>
      {dbError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not reach the database. Is Postgres running and migrated? (
          {dbError})
        </div>
      ) : institutions.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          No institutions found. Run <code className="font-mono">pnpm seed</code>{" "}
          to load the LSU demo dataset.
        </div>
      ) : (
        <PlannerClient institutions={institutions} />
      )}
    </div>
  );
}
