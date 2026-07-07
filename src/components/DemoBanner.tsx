export function DemoBanner() {
  return (
    <div
      className="no-print bg-amber-400 text-amber-950 text-center text-xs font-semibold tracking-wide px-4 py-1.5"
      role="status"
    >
      Demo environment — sample data only. Not for use with real student
      records.
    </div>
  );
}

export const COMPLIANCE_DISCLAIMER =
  "Eligibility results are decision-support only and must be confirmed by the institution's compliance office against the current NCAA manual. Rules vary by division and change by legislative cycle.";

export function ComplianceDisclaimer({
  className = "",
}: {
  className?: string;
}) {
  return (
    <p className={`text-[11px] leading-snug text-slate-500 ${className}`}>
      {COMPLIANCE_DISCLAIMER}
    </p>
  );
}
