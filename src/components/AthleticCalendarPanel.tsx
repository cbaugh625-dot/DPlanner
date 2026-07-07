"use client";

import type { AthleticCalendar } from "@/lib/types";

export function AthleticCalendarPanel({
  calendar,
}: {
  calendar: AthleticCalendar | null;
}) {
  if (!calendar) return null;
  const champ = calendar.championshipTerms
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" + ");
  return (
    <div className="rounded-md border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-bold text-orange-950">
          {calendar.sport} athletic calendar
        </h3>
        <span className="text-xs font-semibold uppercase tracking-wide text-orange-800">
          Championship season: {champ} terms
        </span>
      </div>
      <div className="mt-2 grid gap-x-8 gap-y-1 text-xs text-orange-900 sm:grid-cols-2">
        {calendar.inSeasonWeeks.length > 0 && (
          <div>
            <span className="font-semibold">In-season: </span>
            {calendar.inSeasonWeeks
              .map((w) => `${w.start} → ${w.end}${w.label ? ` (${w.label})` : ""}`)
              .join("; ")}
          </div>
        )}
        {calendar.practiceBlocks.length > 0 && (
          <div>
            <span className="font-semibold">Practice blocks: </span>
            {calendar.practiceBlocks
              .map(
                (b) =>
                  `${b.days.join("/")} ${b.start}–${b.end}${b.label ? ` (${b.label})` : ""}`,
              )
              .join("; ")}
          </div>
        )}
        {calendar.typicalTravelPattern?.description && (
          <div className="sm:col-span-2">
            <span className="font-semibold">Travel: </span>
            {calendar.typicalTravelPattern.description}
            {calendar.typicalTravelPattern.daysPerWeekInSeason
              ? ` (~${calendar.typicalTravelPattern.daysPerWeekInSeason} days/week in season)`
              : ""}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-orange-800/80">
        Terms in the championship season are marked on the grid. v1 checks
        term-level load only — time-of-day class/practice conflict checking
        against live section schedules is planned for a later release.
      </p>
    </div>
  );
}
