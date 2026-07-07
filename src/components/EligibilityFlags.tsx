"use client";

import type { PlanFlag } from "@/lib/types";
import { ComplianceDisclaimer } from "./DemoBanner";

export interface RulesetSummary {
  id: string;
  division: string;
  effectiveDate: string;
  verified: boolean;
  sourceNote: string | null;
}

const SEVERITY_STYLES: Record<
  PlanFlag["severity"],
  { box: string; dot: string; label: string }
> = {
  error: {
    box: "border-red-200 bg-red-50 text-red-900",
    dot: "bg-red-500",
    label: "Eligibility risk",
  },
  warning: {
    box: "border-amber-200 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
    label: "Warning",
  },
  info: {
    box: "border-blue-200 bg-blue-50 text-blue-900",
    dot: "bg-blue-500",
    label: "Note",
  },
};

export function severityChip(severity: PlanFlag["severity"]) {
  return SEVERITY_STYLES[severity];
}

export function EligibilityFlags({
  flags,
  ruleset,
}: {
  flags: PlanFlag[];
  ruleset: RulesetSummary | null;
}) {
  const errors = flags.filter((f) => f.severity === "error");
  const warnings = flags.filter((f) => f.severity === "warning");
  const infos = flags.filter((f) => f.severity === "info");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-800">NCAA eligibility check</h3>
        {ruleset ? (
          <span className="text-xs text-slate-500">
            {ruleset.division} ruleset · effective {ruleset.effectiveDate}
          </span>
        ) : (
          <span className="text-xs font-semibold text-red-600">
            No ruleset found for this division — eligibility NOT checked.
          </span>
        )}
        {ruleset && !ruleset.verified && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-amber-300">
            Needs compliance verification
          </span>
        )}
        {ruleset && errors.length === 0 && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-300">
            No eligibility risks found
          </span>
        )}
        {errors.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-800 ring-1 ring-red-300">
            {errors.length} eligibility risk{errors.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {[...errors, ...warnings, ...infos].map((f, i) => {
        const style = SEVERITY_STYLES[f.severity];
        return (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${style.box}`}
          >
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
            />
            <div>
              <span className="font-semibold">
                {style.label}
                {f.term ? ` · ${f.term}` : ""}
              </span>{" "}
              {f.message}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wide opacity-60">
                {f.ruleKey}
              </span>
            </div>
          </div>
        );
      })}

      <ComplianceDisclaimer className="pt-1" />
    </div>
  );
}
