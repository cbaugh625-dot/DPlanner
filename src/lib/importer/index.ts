export { parseCatalog } from "./parse";
export { persistCatalog } from "./persist";
export {
  parsePrereqExpression,
  evaluateExpression,
  courseCodesInExpression,
} from "./prereqExpr";
export type {
  CatalogBundle,
  ImportError,
  ParseResult,
  RawImportFiles,
} from "./types";

import type { ImportError } from "./types";

/** Human-readable, grouped error report for CLI / UI display. */
export function formatErrorReport(errors: ImportError[]): string {
  if (errors.length === 0) return "No errors.";
  const byFile = new Map<string, ImportError[]>();
  for (const e of errors) {
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }
  const lines: string[] = [
    `Import failed with ${errors.length} error(s). Nothing was imported.`,
    "",
  ];
  for (const [file, errs] of byFile) {
    lines.push(`${file}:`);
    for (const e of errs) {
      const loc = e.line ? ` (line ${e.line}${e.field ? `, ${e.field}` : ""})` : e.field ? ` (${e.field})` : "";
      lines.push(`  - ${e.message}${loc}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
