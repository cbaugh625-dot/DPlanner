"use client";

import type { PlannedTerm } from "@/lib/types";
import { termLabel } from "@/lib/types";

export interface CourseIndexEntry {
  code: string;
  title: string;
  credits: number;
  difficulty: number | null;
}

export function PlanGrid({
  terms,
  courseIndex,
}: {
  terms: PlannedTerm[];
  courseIndex: Record<string, CourseIndexEntry>;
}) {
  if (terms.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No terms to display — the plan could not be generated.
      </p>
    );
  }

  // Group terms into academic years (fall starts a new year).
  const years: PlannedTerm[][] = [];
  for (const t of terms) {
    if (t.term.type === "fall" || years.length === 0) years.push([]);
    years[years.length - 1].push(t);
  }

  return (
    <div className="space-y-4">
      {years.map((yearTerms, yi) => (
        <div key={yi}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
            Year {yi + 1}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {yearTerms.map((t) => (
              <TermCard key={t.termIndex} term={t} courseIndex={courseIndex} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TermCard({
  term,
  courseIndex,
}: {
  term: PlannedTerm;
  courseIndex: Record<string, CourseIndexEntry>;
}) {
  const optional = term.term.type === "summer" || term.term.type === "winter";
  return (
    <div
      className={`rounded-md border bg-white shadow-sm ${
        term.inSeason ? "border-orange-300" : "border-slate-200"
      }`}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b text-sm font-semibold ${
          term.inSeason
            ? "bg-orange-50 border-orange-200 text-orange-900"
            : "bg-slate-50 border-slate-200 text-slate-800"
        }`}
      >
        <span>
          {termLabel(term.term)}
          {optional && (
            <span className="ml-1.5 text-[10px] font-medium uppercase text-slate-400">
              optional term
            </span>
          )}
        </span>
        {term.inSeason && (
          <span className="rounded-full bg-orange-200/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-900">
            In season
          </span>
        )}
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {term.courseIds.length === 0 && (
          <li className="px-3 py-2 text-slate-400 italic">No courses</li>
        )}
        {term.courseIds.map((id) => {
          const c = courseIndex[id];
          return (
            <li key={id} className="flex items-baseline gap-2 px-3 py-1.5">
              <span className="font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                {c?.code ?? id}
              </span>
              <span className="truncate text-slate-600" title={c?.title}>
                {c?.title}
              </span>
              <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                {c?.credits} cr
              </span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-slate-200 px-3 py-1.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-semibold text-slate-700">
            {term.totalCredits} credits
          </span>
          <span>
            {term.cumulativeDegreeCredits} cr · {term.cumulativeDegreePercent}% of
            degree
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
          <div
            className="h-1.5 rounded-full bg-indigo-500"
            style={{ width: `${term.cumulativeDegreePercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
